import type { BoardConfig, GameSettings, ShipDefinition } from "../types/game";

const namedShips = ["Carrier", "Battleship", "Cruiser", "Submarine", "Destroyer"];

function fleet(lengths: number[]): ShipDefinition[] {
  return lengths.map((length, index) => ({
    id: `${namedShips[index].toLowerCase()}-${length}`,
    name: namedShips[index],
    length
  }));
}

function generatedFleet(size: number): ShipDefinition[] {
  const area = size * size;
  const targetCoverage = Math.max(0.12, Math.min(0.18, 0.16 - size / 1000));
  const targetCells = Math.round(area * targetCoverage);
  const count = Math.max(8, Math.round(size * 0.55));
  const maxLength = Math.max(6, Math.round(size * 0.38));
  const minLength = 3;
  const ships: ShipDefinition[] = [];
  let remaining = targetCells;

  for (let index = 0; index < count; index += 1) {
    const shipsLeft = count - index;
    const ideal = Math.round(remaining / shipsLeft);
    const length = Math.max(minLength, Math.min(maxLength, ideal + (index % 3) - 1));
    ships.push({
      id: `extended-${index + 1}-${length}`,
      name: `Fleet ${index + 1}`,
      length
    });
    remaining -= length;
  }

  return ships.sort((a, b) => b.length - a.length);
}

export const boardConfigs: BoardConfig[] = [
  { id: "classic-8", label: "Classic 8x8", size: 8, fleet: fleet([4, 3, 3, 2, 2]) },
  { id: "classic-9", label: "Classic 9x9", size: 9, fleet: fleet([5, 4, 3, 3, 2]) },
  { id: "classic-10", label: "Classic 10x10", size: 10, fleet: fleet([5, 4, 3, 3, 2]) },
  { id: "extended-12", label: "Extended 12x12", size: 12, fleet: fleet([6, 5, 4, 3, 2]) },
  { id: "extended-14", label: "Extended 14x14", size: 14, fleet: fleet([7, 6, 5, 4, 3]) },
  { id: "extended-16", label: "Extended 16x16", size: 16, fleet: fleet([8, 7, 5, 5, 3]) },
  { id: "extended-32", label: "Extended 32x32", size: 32, fleet: generatedFleet(32) }
];

export const defaultSettings: GameSettings = {
  boardId: "classic-8",
  mode: "classic",
  blitz: {
    enabled: false,
    seconds: 10,
    timeoutAction: "lose-turn"
  }
};

export function getBoardConfig(boardId: string): BoardConfig {
  return boardConfigs.find((board) => board.id === boardId) ?? boardConfigs[0];
}
