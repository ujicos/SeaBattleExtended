import type { BoardConfig, GameSettings, ShipDefinition } from "../types/game";

function ship(name: string, length: number): ShipDefinition {
  return {
    id: name.toLowerCase().replaceAll(" ", "-"),
    name,
    length
  };
}

export const boardConfigs: BoardConfig[] = [
  {
    id: "classic-8",
    label: "Classic 8x8",
    size: 8,
    fleet: [
      ship("Carrier", 4),
      ship("Battleship", 3),
      ship("Cruiser", 3),
      ship("Submarine", 2),
      ship("Destroyer", 2)
    ]
  },
  {
    id: "classic-9",
    label: "Classic 9x9",
    size: 9,
    fleet: [
      ship("Carrier", 5),
      ship("Battleship", 4),
      ship("Cruiser", 3),
      ship("Submarine", 3),
      ship("Destroyer", 2)
    ]
  },
  {
    id: "classic-10",
    label: "Classic 10x10",
    size: 10,
    fleet: [
      ship("Carrier", 5),
      ship("Battleship", 4),
      ship("Cruiser", 3),
      ship("Submarine", 3),
      ship("Destroyer", 2)
    ]
  },
  {
    id: "extended-12",
    label: "Extended 12x12",
    size: 12,
    fleet: [
      ship("Super Carrier", 6),
      ship("Battleship", 5),
      ship("Cruiser", 4),
      ship("Submarine", 3),
      ship("Destroyer", 3),
      ship("Patrol Boat", 2)
    ]
  },
  {
    id: "extended-14",
    label: "Extended 14x14",
    size: 14,
    fleet: [
      ship("Super Carrier", 7),
      ship("Battleship", 6),
      ship("Heavy Cruiser", 5),
      ship("Cruiser", 4),
      ship("Submarine", 4),
      ship("Destroyer", 3),
      ship("Patrol Boat", 2)
    ]
  },
  {
    id: "extended-16",
    label: "Extended 16x16",
    size: 16,
    fleet: [
      ship("Super Carrier", 8),
      ship("Battleship", 7),
      ship("Heavy Cruiser", 6),
      ship("Cruiser", 5),
      ship("Submarine", 5),
      ship("Destroyer", 4),
      ship("Patrol Boat", 3),
      ship("Scout Boat", 2)
    ]
  },
  {
    id: "extended-32",
    label: "Large Battle 32x32",
    size: 32,
    fleet: [
      ship("Titan Carrier", 12),
      ship("Super Battleship", 10),
      ship("Heavy Cruiser Alpha", 9),
      ship("Heavy Cruiser Beta", 8),
      ship("Cruiser Alpha", 7),
      ship("Cruiser Beta", 6),
      ship("Submarine Alpha", 6),
      ship("Submarine Beta", 5),
      ship("Destroyer Alpha", 5),
      ship("Destroyer Beta", 4),
      ship("Patrol Boat", 3),
      ship("Scout Boat", 2)
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
