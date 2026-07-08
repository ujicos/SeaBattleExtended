import { ChevronDown, Waves } from "lucide-react";
import { memo, useMemo, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { coordKey, getShipBufferCells, getShipCells, isShipSunk } from "../game/board";
import type { BoardState, Coordinate, Orientation, PlacedShip, ShipDefinition, ShotResult } from "../types/game";

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
  fogActive?: boolean;
  stormPhase?: "clear" | "warning" | "wave";
  compact?: boolean;
  label: string;
  collapsible?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

export function isSunkBufferCoord(board: BoardState, coord: Coordinate): boolean {
  const key = coordKey(coord);
  return board.ships.filter(isShipSunk).some((ship) => getShipBufferCells(ship, board.size).some((cell) => coordKey(cell) === key));
}

function cellClass(value: "empty" | "ship" | ShotResult, preview?: "valid" | "invalid"): string {
  const classes = ["cell", `cell-${value}`];
  if (preview) {
    classes.push(`cell-preview-${preview}`);
  }
  return classes.join(" ");
}

function hashSegment(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 9973;
  }
  return hash;
}

function shipSegmentIndex(ship: PlacedShip, coord: Coordinate): number {
  return ship.orientation === "horizontal" ? coord.col - ship.origin.col : coord.row - ship.origin.row;
}

function shipSegmentKind(ship: PlacedShip, index: number): "solo" | "bow" | "middle" | "stern" {
  if (ship.length === 1) {
    return "solo";
  }
  if (index === 0) {
    return "bow";
  }
  if (index === ship.length - 1) {
    return "stern";
  }
  return "middle";
}

interface ShipSpriteProps {
  ship: PlacedShip;
  coord: Coordinate;
  destroyed: boolean;
}

function ShipSprite({ ship, coord, destroyed }: ShipSpriteProps) {
  const index = shipSegmentIndex(ship, coord);
  const kind = shipSegmentKind(ship, index);
  const variant = kind === "middle" ? (hashSegment(`${ship.spriteSeed ?? ship.id}:${index}`) % 4) + 1 : 1;
  return (
    <span
      className={`ship-sprite ship-${ship.orientation} ship-${kind} ship-variant-${variant}${destroyed ? " ship-destroyed" : ""}`}
      aria-hidden="true"
    >
      <span className="ship-hull" />
      {kind === "middle" && <span className="ship-deck" />}
      {destroyed && <span className="ship-crack" />}
    </span>
  );
}

export const BoardGrid = memo(function BoardGrid({
  board,
  revealShips,
  interactive = false,
  selectedCoord,
  onCellPress,
  onCellHover,
  preview,
  attackAnimation,
  fogActive = false,
  stormPhase = "clear",
  compact = false,
  label,
  collapsible = false,
  expanded = true,
  onToggleExpand
}: BoardGridProps) {
  const touchDrag = useRef<{ active: boolean; moved: boolean; coord: Coordinate | null }>({ active: false, moved: false, coord: null });
  const previewMap = useMemo(
    () => new Map(preview?.cells.map((cell) => [coordKey(cell), preview.valid ? "valid" : "invalid"])),
    [preview]
  );
  const { shipByCell, sunkBufferMap, sunkShipMap } = useMemo(() => {
    const nextShipByCell = new Map<string, PlacedShip>();
    const nextSunkBufferMap = new Map<string, true>();
    const nextSunkShipMap = new Map<string, true>();

    for (const ship of board.ships) {
      for (const cell of getShipCells(ship)) {
        nextShipByCell.set(coordKey(cell), ship);
      }
      if (!isShipSunk(ship)) {
        continue;
      }
      for (const cell of getShipBufferCells(ship, board.size)) {
        nextSunkBufferMap.set(coordKey(cell), true);
      }
      for (const cell of ship.hits) {
        nextSunkShipMap.set(coordKey(cell), true);
      }
    }

    return { shipByCell: nextShipByCell, sunkBufferMap: nextSunkBufferMap, sunkShipMap: nextSunkShipMap };
  }, [board]);
  const cells = useMemo(
    () =>
      Array.from({ length: board.size * board.size }, (_, index) => ({
        row: Math.floor(index / board.size),
        col: index % board.size
      })),
    [board.size]
  );

  const showGrid = !collapsible || expanded;

  function coordFromGridEvent(event: ReactPointerEvent<HTMLElement>): Coordinate | null {
    const grid = event.currentTarget;
    const rect = grid.getBoundingClientRect();
    const col = Math.floor(((event.clientX - rect.left) / rect.width) * board.size);
    const row = Math.floor(((event.clientY - rect.top) / rect.height) * board.size);
    if (row < 0 || row >= board.size || col < 0 || col >= board.size) {
      return null;
    }
    return { row, col };
  }

  function sameCoord(left: Coordinate | null, right: Coordinate | null): boolean {
    return Boolean(left && right && left.row === right.row && left.col === right.col);
  }

  function handleTouchMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!touchDrag.current.active) {
      return;
    }
    const coord = coordFromGridEvent(event);
    if (!sameCoord(touchDrag.current.coord, coord)) {
      touchDrag.current.moved = true;
      touchDrag.current.coord = coord;
      onCellHover?.(coord);
    }
  }

  function handleTouchEnd() {
    if (touchDrag.current.active && touchDrag.current.coord) {
      onCellPress?.(touchDrag.current.coord);
    }
    touchDrag.current = { active: false, moved: false, coord: null };
    onCellHover?.(null);
  }

  return (
    <section className={compact ? "board-panel compact-board" : "board-panel"}>
      {collapsible ? (
        <button
          className="board-heading collapsible-header"
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
        >
          <span>{label}</span>
          <small>{board.size}x{board.size}</small>
          <ChevronDown className={`collapse-chevron${expanded ? " expanded" : ""}`} size={16} />
        </button>
      ) : (
        <div className="board-heading">
          <span>{label}</span>
          <small>{board.size}x{board.size}</small>
        </div>
      )}
      {showGrid && (
        <div
          className={`board-grid${fogActive ? " fog-active" : ""}${stormPhase !== "clear" ? ` storm-${stormPhase}` : ""}`}
          style={{ "--board-size": board.size } as React.CSSProperties}
          onPointerMove={handleTouchMove}
          onPointerUp={handleTouchEnd}
          onPointerCancel={handleTouchEnd}
          onPointerLeave={() => {
            touchDrag.current = { active: false, moved: false, coord: null };
            onCellHover?.(null);
          }}
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
          {fogActive && <div className="fog-tide" aria-hidden="true" />}
          {stormPhase !== "clear" && <div className="storm-front" aria-hidden="true" />}
          {cells.map((coord) => {
            const key = coordKey(coord);
            const shot = board.shots[key];
            const ship = shipByCell.get(key);
            const value: "empty" | "ship" | ShotResult = shot ?? (revealShips && ship ? "ship" : "empty");
            const activeImpact = attackAnimation && coordKey(attackAnimation.coord) === key && attackAnimation.result !== "miss";
            const previewState = previewMap.get(key) as "valid" | "invalid" | undefined;
            const sunkBuffer = sunkBufferMap.has(key);
            const sunkShip = sunkShipMap.has(key);
            const blocked = interactive && sunkBuffer && !sunkShip;
            const selected = selectedCoord && coordKey(selectedCoord) === key;
            const showShipSprite = Boolean(ship && ((!shot && revealShips) || sunkShip));

            return (
              <button
                className={`${cellClass(value, previewState)}${sunkBuffer ? " cell-sunk-buffer" : ""}${sunkShip ? " cell-sunk-ship" : ""}${blocked ? " cell-blocked-target" : ""}${selected ? " cell-selected-target" : ""}`}
                key={key}
                type="button"
                disabled={!interactive || blocked}
                aria-label={`Row ${coord.row + 1}, column ${coord.col + 1}`}
                onPointerEnter={() => onCellHover?.(coord)}
                onPointerDown={(event) => {
                  if (event.pointerType === "touch" || event.pointerType === "pen") {
                    touchDrag.current = { active: true, moved: false, coord };
                    onCellHover?.(coord);
                    return;
                  }
                  onCellPress?.(coord);
                }}
              >
                {value === "miss" && <Waves size={13} />}
                {showShipSprite && ship && (
                  <ShipSprite ship={ship} coord={coord} destroyed={sunkShip} />
                )}
                {activeImpact && <span className="blast" />}
                {(value === "hit" || sunkShip) && <span className="fire-glow" />}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
});
