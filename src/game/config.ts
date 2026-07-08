import type { BoardConfig, GameSettings, ShipDefinition } from "../types/game";

function ship(name: string, length: number): ShipDefinition {
  return {
    id: name.toLowerCase().replaceAll(" ", "-"),
    name,
    length
  };
}

const suffixes = [
  "Alpha",
  "Beta",
  "Gamma",
  "Delta",
  "Epsilon",
  "Zeta",
  "Eta",
  "Theta",
  "Iota",
  "Kappa",
  "Lambda",
  "Mu",
  "Nu",
  "Xi",
  "Omicron",
  "Pi"
];

function ships(name: string, length: number, count = 1): ShipDefinition[] {
  return Array.from({ length: count }, (_, index) => ship(count === 1 ? name : `${name} ${suffixes[index] ?? index + 1}`, length));
}

export const boardConfigs: BoardConfig[] = [
  {
    id: "classic-8",
    label: "Classic 8x8",
    size: 8,
    fleet: [
      ...ships("Battleship", 4),
      ...ships("Cruiser", 3),
      ...ships("Destroyer", 2, 2),
      ...ships("Scout Boat", 1, 3)
    ]
  },
  {
    id: "classic-9",
    label: "Classic 9x9",
    size: 9,
    fleet: [
      ...ships("Battleship", 4),
      ...ships("Cruiser", 3, 2),
      ...ships("Destroyer", 2, 2),
      ...ships("Scout Boat", 1, 4)
    ]
  },
  {
    id: "classic-10",
    label: "Classic 10x10",
    size: 10,
    fleet: [
      ...ships("Battleship", 4),
      ...ships("Cruiser", 3, 2),
      ...ships("Destroyer", 2, 3),
      ...ships("Scout Boat", 1, 4)
    ]
  },
  {
    id: "extended-12",
    label: "Extended 12x12",
    size: 12,
    fleet: [
      ...ships("Carrier", 5),
      ...ships("Battleship", 4, 2),
      ...ships("Cruiser", 3, 2),
      ...ships("Destroyer", 2, 3),
      ...ships("Scout Boat", 1, 5)
    ]
  },
  {
    id: "extended-14",
    label: "Extended 14x14",
    size: 14,
    fleet: [
      ...ships("Super Carrier", 6),
      ...ships("Battleship", 5),
      ...ships("Cruiser", 4, 2),
      ...ships("Submarine", 3, 3),
      ...ships("Destroyer", 2, 3),
      ...ships("Scout Boat", 1, 6)
    ]
  },
  {
    id: "extended-16",
    label: "Extended 16x16",
    size: 16,
    fleet: [
      ...ships("Super Carrier", 7),
      ...ships("Battleship", 6),
      ...ships("Heavy Cruiser", 5, 2),
      ...ships("Cruiser", 4, 2),
      ...ships("Submarine", 3, 2),
      ...ships("Destroyer", 2, 4),
      ...ships("Scout Boat", 1, 8)
    ]
  },
  {
    id: "extended-24",
    label: "Large Battle 24x24",
    size: 24,
    fleet: [
      ...ships("Titan Carrier", 9),
      ...ships("Super Battleship", 8),
      ...ships("Heavy Cruiser", 6, 2),
      ...ships("Cruiser", 5, 3),
      ...ships("Submarine", 4, 3),
      ...ships("Destroyer", 3, 4),
      ...ships("Patrol Boat", 2, 5),
      ...ships("Scout Boat", 1, 10)
    ]
  }
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
