import { Ship, Waves } from "lucide-react";
import { coordKey, findShipAt, getShipBufferCells, getVisibleCell, isShipSunk } from "../game/board";
import type { BoardState, Coordinate, Orientation, ShipDefinition, ShotResult } from "../types/game";

export interface AttackAnimation {
  id: string;
  coord: Coordinate;
  direction: "left-right" | "right-left" | "top-bottom" | "bottom-top";
  result: ShotResult;
}

interface BoardGridProps {
  board: BoardState;
  revealShips: boolean;
  interactive?: boolean;
  selectedCoord?: Coordinate | null;
  selectedShip?: ShipDefinition;
  orientation?: Orientation;
  onCellPress?: (coord: Coordinate) => void;
  onCellHover?: (coord: Coordinate | null) => void;
  preview?: { cells: Coordinate[]; valid: boolean } | null;
  attackAnimation?: AttackAnimation | null;
  compact?: boolean;
  label: string;
}

function cellClass(value: "empty" | "ship" | ShotResult, preview?: "valid" | "invalid"): string {
  const classes = ["cell", `cell-${value}`];
  if (preview) {
    classes.push(`cell-preview-${preview}`);
  }
  return classes.join(" ");
}

export function BoardGrid({
  board,
  revealShips,
  interactive = false,
  selectedCoord,
  onCellPress,
  onCellHover,
  preview,
  attackAnimation,
  compact = false,
  label
}: BoardGridProps) {
  const previewMap = new Map(preview?.cells.map((cell) => [coordKey(cell), preview.valid ? "valid" : "invalid"]));
  const sunkBufferMap = new Map<string, true>();
  const sunkShipMap = new Map<string, true>();
  for (const ship of board.ships.filter(isShipSunk)) {
    for (const cell of getShipBufferCells(ship, board.size)) {
      sunkBufferMap.set(coordKey(cell), true);
    }
    for (const cell of ship.hits) {
      sunkShipMap.set(coordKey(cell), true);
    }
  }
  const cells = Array.from({ length: board.size * board.size }, (_, index) => ({
    row: Math.floor(index / board.size),
    col: index % board.size
  }));

  return (
    <section className={compact ? "board-panel compact-board" : "board-panel"}>
      <div className="board-heading">
        <span>{label}</span>
        <small>{board.size}x{board.size}</small>
      </div>
      <div
        className="board-grid"
        style={{ "--board-size": board.size } as React.CSSProperties}
        onPointerLeave={() => onCellHover?.(null)}
      >
        {attackAnimation && (
          <div
            className={`attack-animation attack-${attackAnimation.direction} attack-${attackAnimation.result}`}
            style={
              {
                "--target-row": attackAnimation.coord.row,
                "--target-col": attackAnimation.coord.col,
                "--board-size": board.size
              } as React.CSSProperties
            }
            key={attackAnimation.id}
          >
            <span className="plane" />
            <span className="bomb" />
            <span className="impact" />
          </div>
        )}
        {cells.map((coord) => {
          const value = getVisibleCell(board, coord, revealShips);
          const ship = revealShips ? findShipAt(board, coord) : undefined;
          const key = coordKey(coord);
          const previewState = previewMap.get(key) as "valid" | "invalid" | undefined;
          const sunkBuffer = sunkBufferMap.has(key);
          const sunkShip = sunkShipMap.has(key);
          const selected = selectedCoord && coordKey(selectedCoord) === key;

          return (
            <button
              className={`${cellClass(value, previewState)}${sunkBuffer ? " cell-sunk-buffer" : ""}${sunkShip ? " cell-sunk-ship" : ""}${selected ? " cell-selected-target" : ""}`}
              key={key}
              type="button"
              disabled={!interactive}
              aria-label={`Row ${coord.row + 1}, column ${coord.col + 1}`}
              onPointerEnter={() => onCellHover?.(coord)}
              onPointerDown={() => onCellPress?.(coord)}
            >
              {value === "miss" && <Waves size={13} />}
              {(value === "hit" || value === "sunk") && <span className="blast" />}
              {(value === "hit" || value === "sunk") && <span className="smoke" />}
              {sunkShip && <span className="wreck" />}
              {ship && value === "ship" && <Ship size={Math.max(10, Math.min(16, 180 / board.size))} />}
            </button>
          );
        })}
      </div>
    </section>
  );
}
