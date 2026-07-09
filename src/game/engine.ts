import { defaultSettings, getBoardConfig } from "./config";
import { allShipsSunk, makeBoard, randomizeFleet, receiveShot, seedTreasures } from "./board";
import type { BoardState, Coordinate, GameSettings, GameState, PlayerSide, ShotOutcome } from "../types/game";

export function createBoardForSettings(settings: GameSettings): BoardState {
  const config = getBoardConfig(settings.boardId);
  const board = randomizeFleet(config);
  const shieldCount = settings.modifiers.treasureTiles ? Math.max(1, Math.floor(config.size / 12)) : 0;
  const fakeCount = settings.modifiers.pirateChaos ? Math.max(1, Math.floor(config.size / 12)) : 0;
  return shieldCount || fakeCount ? seedTreasures(board, shieldCount, fakeCount) : board;
}

export function createInitialGame(settings: GameSettings = defaultSettings): GameState {
  const config = getBoardConfig(settings.boardId);
  return {
    phase: "menu",
    settings,
    localBoard: createBoardForSettings(settings),
    remoteBoard: makeBoard(config),
    turn: "local",
    selectedShipId: null,
    winner: null,
    moves: 0,
    startedAt: null,
    endedAt: null,
    log: []
  };
}

export function resetBoards(state: GameState, settings: GameSettings): GameState {
  const config = getBoardConfig(settings.boardId);
  return {
    ...state,
    settings,
    phase: "placing",
    localBoard: createBoardForSettings(settings),
    remoteBoard: makeBoard(config),
    selectedShipId: null,
    winner: null,
    moves: 0,
    startedAt: null,
    endedAt: null,
    log: [`Setup: ${config.label}`]
  };
}

export function startBattle(state: GameState, remoteBoard?: BoardState): GameState {
  const now = performance.now();
  return {
    ...state,
    phase: "battle",
    remoteBoard: remoteBoard ?? state.remoteBoard,
    startedAt: now,
    turn: "local",
    log: ["Battle started", ...state.log]
  };
}

export function attack(state: GameState, targetSide: PlayerSide, coord: Coordinate): { state: GameState; outcome: ShotOutcome } {
  if (state.phase !== "battle" || state.winner) {
    return {
      state,
      outcome: { result: "invalid", nextTurn: state.turn, winner: state.winner }
    };
  }

  const boardKey = targetSide === "local" ? "localBoard" : "remoteBoard";
  const attacker: PlayerSide = targetSide === "local" ? "remote" : "local";
  if (state.turn !== attacker) {
    return {
      state,
      outcome: { result: "invalid", nextTurn: state.turn, winner: state.winner }
    };
  }

  const shot = receiveShot(state[boardKey], coord);
  if (shot.result === "duplicate") {
    return {
      state,
      outcome: { result: "duplicate", nextTurn: state.turn, winner: state.winner }
    };
  }

  const winner = allShipsSunk(shot.board) ? attacker : null;
  const nextTurn = shot.result === "miss" ? targetSide : attacker;
  const phase = winner === "local" ? "victory" : winner === "remote" ? "defeat" : state.phase;

  const nextState: GameState = {
    ...state,
    [boardKey]: shot.board,
    turn: winner ? attacker : nextTurn,
    winner,
    phase,
    moves: state.moves + 1,
    endedAt: winner ? performance.now() : state.endedAt,
    log: [`${attacker} ${shot.result.toUpperCase()} at ${coord.row + 1},${coord.col + 1}`, ...state.log].slice(0, 30)
  };

  return {
    state: nextState,
    outcome: {
      result: shot.result,
      shipId: shot.shipId,
      nextTurn,
      winner
    }
  };
}
