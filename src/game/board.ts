import type { BoardConfig, BoardState, Coordinate, Orientation, PlacedShip, ShipDefinition, ShotResult } from "../types/game";

export function coordKey(coord: Coordinate): string {
  return `${coord.row}:${coord.col}`;
}

export function makeBoard(config: BoardConfig): BoardState {
  return {
    size: config.size,
    ships: [],
    shots: {}
  };
}

export function getShipCells(ship: Pick<PlacedShip, "origin" | "length" | "orientation">): Coordinate[] {
  return Array.from({ length: ship.length }, (_, offset) => ({
    row: ship.origin.row + (ship.orientation === "vertical" ? offset : 0),
    col: ship.origin.col + (ship.orientation === "horizontal" ? offset : 0)
  }));
}

export function isInsideBoard(size: number, cells: Coordinate[]): boolean {
  return cells.every((cell) => cell.row >= 0 && cell.col >= 0 && cell.row < size && cell.col < size);
}

export function cellsTouch(a: Coordinate, b: Coordinate): boolean {
  return Math.abs(a.row - b.row) <= 1 && Math.abs(a.col - b.col) <= 1;
}

function makeSpriteSeed(ship: ShipDefinition): string {
  return `${ship.id}-${Math.random().toString(36).slice(2, 10)}`;
}

function getSpriteSeed(ship: ShipDefinition): string {
  return "spriteSeed" in ship && typeof ship.spriteSeed === "string" ? ship.spriteSeed : makeSpriteSeed(ship);
}

export function canPlaceShip(
  board: BoardState,
  ship: ShipDefinition,
  origin: Coordinate,
  orientation: Orientation,
  ignoreShipId?: string
): boolean {
  const candidateCells = getShipCells({ ...ship, origin, orientation });

  if (!isInsideBoard(board.size, candidateCells)) {
    return false;
  }

  const otherShips = board.ships.filter((placed) => placed.id !== ignoreShipId);
  return candidateCells.every((candidate) =>
    otherShips.every((placed) => getShipCells(placed).every((occupied) => !cellsTouch(candidate, occupied)))
  );
}

export function hasLegalFleetPlacement(board: BoardState, config: BoardConfig): boolean {
  if (board.size !== config.size || board.ships.length !== config.fleet.length) {
    return false;
  }

  const requiredShips = new Map(config.fleet.map((ship) => [ship.id, ship.length]));
  const placedShips = new Set<string>();

  for (const ship of board.ships) {
    if (placedShips.has(ship.id) || requiredShips.get(ship.id) !== ship.length) {
      return false;
    }
    placedShips.add(ship.id);

    if (!isInsideBoard(board.size, getShipCells(ship)) || !canPlaceShip(board, ship, ship.origin, ship.orientation, ship.id)) {
      return false;
    }
  }

  return placedShips.size === requiredShips.size;
}

export function placeShip(
  board: BoardState,
  ship: ShipDefinition,
  origin: Coordinate,
  orientation: Orientation
): BoardState {
  if (!canPlaceShip(board, ship, origin, orientation, ship.id)) {
    return board;
  }

  const placedShip: PlacedShip = {
    ...ship,
    origin,
    orientation,
    hits: "hits" in ship && Array.isArray(ship.hits) ? ship.hits : [],
    spriteSeed: getSpriteSeed(ship)
  };

  return {
    ...board,
    ships: [...board.ships.filter((placed) => placed.id !== ship.id), placedShip]
  };
}

export function removeShip(board: BoardState, shipId: string): BoardState {
  return {
    ...board,
    ships: board.ships.filter((ship) => ship.id !== shipId)
  };
}

export function findShipAt(board: BoardState, coord: Coordinate): PlacedShip | undefined {
  return board.ships.find((ship) => getShipCells(ship).some((cell) => coordKey(cell) === coordKey(coord)));
}

export function isShipSunk(ship: PlacedShip): boolean {
  const hitKeys = new Set(ship.hits.map(coordKey));
  return getShipCells(ship).every((cell) => hitKeys.has(coordKey(cell)));
}

export function getShipBufferCells(ship: PlacedShip, boardSize: number): Coordinate[] {
  const shipCells = new Set(getShipCells(ship).map(coordKey));
  const buffer = new Map<string, Coordinate>();

  for (const cell of getShipCells(ship)) {
    for (let row = cell.row - 1; row <= cell.row + 1; row += 1) {
      for (let col = cell.col - 1; col <= cell.col + 1; col += 1) {
        if (row < 0 || col < 0 || row >= boardSize || col >= boardSize) {
          continue;
        }
        const coord = { row, col };
        if (!shipCells.has(coordKey(coord))) {
          buffer.set(coordKey(coord), coord);
        }
      }
    }
  }

  return [...buffer.values()];
}

export function allShipsSunk(board: BoardState): boolean {
  return board.ships.length > 0 && board.ships.every(isShipSunk);
}

export function receiveShot(board: BoardState, coord: Coordinate): { board: BoardState; result: ShotResult; shipId?: string } {
  const key = coordKey(coord);
  if (board.shots[key]) {
    return { board, result: "duplicate" };
  }

  const target = findShipAt(board, coord);
  if (!target) {
    return {
      board: { ...board, shots: { ...board.shots, [key]: "miss" } },
      result: "miss"
    };
  }

  const updatedShip = {
    ...target,
    hits: [...target.hits, coord]
  };
  const result: ShotResult = isShipSunk(updatedShip) ? "sunk" : "hit";

  return {
    board: {
      ...board,
      ships: board.ships.map((ship) => (ship.id === target.id ? updatedShip : ship)),
      shots: { ...board.shots, [key]: result }
    },
    result,
    shipId: target.id
  };
}

export function randomizeFleet(config: BoardConfig, maxAttempts = 900): BoardState {
  const sortedFleet = [...config.fleet].sort((a, b) => b.length - a.length);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let board = makeBoard(config);
    let failed = false;

    for (const ship of sortedFleet) {
      const candidates: Array<{ origin: Coordinate; orientation: Orientation }> = [];
      for (let row = 0; row < config.size; row += 1) {
        for (let col = 0; col < config.size; col += 1) {
          for (const orientation of ["horizontal", "vertical"] as const) {
            const origin = { row, col };
            if (canPlaceShip(board, ship, origin, orientation)) {
              candidates.push({ origin, orientation });
            }
          }
        }
      }

      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      if (!pick) {
        failed = true;
        break;
      }
      board = placeShip(board, ship, pick.origin, pick.orientation);
    }

    if (!failed && hasLegalFleetPlacement(board, config)) {
      return board;
    }
  }

  return makeBoard(config);
}

export function getVisibleCell(board: BoardState, coord: Coordinate, revealShips: boolean): "empty" | "ship" | ShotResult {
  const shot = board.shots[coordKey(coord)];
  if (shot) {
    return shot;
  }
  return revealShips && findShipAt(board, coord) ? "ship" : "empty";
}
