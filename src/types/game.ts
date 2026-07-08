export type PlayerSide = "local" | "remote";
export type Orientation = "horizontal" | "vertical";
export type CellState = "empty" | "ship" | "miss" | "hit" | "sunk";
export type Phase = "menu" | "setup" | "placing" | "lobby" | "battle" | "victory" | "defeat";
export type ShotResult = "miss" | "hit" | "sunk" | "shielded" | "duplicate" | "invalid";
export type TreasureKind = "shield" | "fake";

export interface Coordinate {
  row: number;
  col: number;
}

export interface ShipDefinition {
  id: string;
  name: string;
  length: number;
}

export interface PlacedShip extends ShipDefinition {
  orientation: Orientation;
  origin: Coordinate;
  hits: Coordinate[];
  spriteSeed: string;
}

export interface BoardConfig {
  id: string;
  label: string;
  size: number;
  fleet: ShipDefinition[];
}

export interface BlitzConfig {
  enabled: boolean;
  seconds: 5 | 10 | 15 | 30;
  timeoutAction: "lose-turn" | "lose-match";
}

export interface ModifierSettings {
  fogTide: boolean;
  stormMode: boolean;
  treasureTiles: boolean;
  pirateChaos: boolean;
}

export interface GameSettings {
  boardId: string;
  mode: "classic" | "extended";
  blitz: BlitzConfig;
  modifiers: ModifierSettings;
}

export interface BoardState {
  size: number;
  ships: PlacedShip[];
  shots: Record<string, ShotResult>;
  treasures: Record<string, TreasureKind>;
  treasureHits: Record<string, true>;
}

export interface GameState {
  phase: Phase;
  settings: GameSettings;
  localBoard: BoardState;
  remoteBoard: BoardState;
  turn: PlayerSide;
  selectedShipId: string | null;
  winner: PlayerSide | null;
  moves: number;
  startedAt: number | null;
  endedAt: number | null;
  log: string[];
}

export interface ShotOutcome {
  result: ShotResult;
  shipId?: string;
  nextTurn: PlayerSide;
  winner: PlayerSide | null;
}

export interface PeerIdentity {
  playerId: string;
  displayName: string;
  avatar: string;
  statsSummary: {
    games: number;
    wins: number;
    losses: number;
    winRate: number;
  };
}

export interface NetworkMessage {
  type:
    | "identity"
    | "settings"
    | "ready"
    | "shot"
    | "shot-result"
    | "start"
    | "forfeit"
    | "storm-board"
    | "timer"
    | "resync"
    | "game-over";
  payload: unknown;
  messageId: string;
  sentAt: number;
}
