import { Anchor, BarChart3, ChevronDown, Crown, Music2, Radio, Settings, Shield, Trophy, UserRound, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AchievementsPanel } from "./components/AchievementsPanel";
import { BoardGrid, isSunkBufferCoord } from "./components/BoardGrid";
import type { AttackAnimation } from "./components/BoardGrid";
import { ProfilePanel } from "./components/ProfilePanel";
import { SetupPanel } from "./components/SetupPanel";
import { StatsPanel } from "./components/StatsPanel";
import { allShipsSunk, canPlaceShip, coordKey, findShipAt, findTreasureAt, getShipCells, hasBlockingShot, isShipSunk, markShieldedShot, markTreasureShot, placeShip, receiveShot } from "./game/board";
import { boardConfigs, defaultSettings, getBoardConfig } from "./game/config";
import { attack, createBoardForSettings, createInitialGame, resetBoards, startBattle } from "./game/engine";
import { assets } from "./services/assets";
import { audio } from "./services/audio";
import { fetchPresenceStatus, leavePresence, PeerGameClient, pingPresence, type LobbySummary, type PresenceStatus } from "./services/network";
import {
  loadProfile,
  loadStats,
  getAchievement,
  makeIdentity,
  makeEmptyStats,
  awardXp,
  unlockAchievement,
  prestigeStats,
  recordMatch,
  removeMatch,
  saveProfile,
  saveStats,
  xpAwards,
  type PlayerProfile,
  type AchievementDefinition,
  type PlayerStats
} from "./services/storage";
import { loadAppVersion, type AppVersion } from "./services/version";
import type { BoardState, Coordinate, GameSettings, GameState, Orientation, PeerIdentity, PlayerSide, ShotResult } from "./types/game";

const guestIdentity: PeerIdentity = {
  playerId: "local_ai",
  displayName: "Practice Fleet",
  avatar: "radar",
  statsSummary: { games: 0, wins: 0, losses: 0, winRate: 0 }
};

const waitingIdentity: PeerIdentity = {
  playerId: "waiting",
  displayName: "Waiting for opponent",
  avatar: "radar",
  statsSummary: { games: 0, wins: 0, losses: 0, winRate: 0 }
};

function nextUnplacedShipId(settings: GameSettings, placedIds: Set<string>): string | null {
  return getBoardConfig(settings.boardId).fleet.find((ship) => !placedIds.has(ship.id))?.id ?? null;
}

function makeShareLink(roomCode: string): string {
  if (!roomCode) {
    return "";
  }
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomCode);
  url.hash = "";
  return url.toString();
}

function pickOpenShot(board: BoardState): Coordinate | null {
  const totalCells = board.size * board.size;
  let picked: Coordinate | null = null;
  let openCount = 0;

  for (let index = 0; index < totalCells; index += 1) {
    const coord = { row: Math.floor(index / board.size), col: index % board.size };
    if (board.shots[coordKey(coord)]) {
      continue;
    }
    openCount += 1;
    if (Math.floor(Math.random() * openCount) === 0) {
      picked = coord;
    }
  }

  return picked;
}

function xpForShot(result: ShotResult): number {
  if (result === "sunk") {
    return xpAwards.shot + xpAwards.hit + xpAwards.sunk;
  }
  if (result === "hit") {
    return xpAwards.shot + xpAwards.hit;
  }
  if (result === "miss") {
    return xpAwards.shot;
  }
  return 0;
}

function normalizeSettings(settings: GameSettings): GameSettings {
  return {
    ...settings,
    modifiers: {
      fogTide: settings.modifiers?.fogTide ?? false,
      stormMode: settings.modifiers?.stormMode ?? false,
      treasureTiles: settings.modifiers?.treasureTiles ?? false,
      pirateChaos: settings.modifiers?.pirateChaos ?? false
    }
  };
}

function formatNetworkStatus(status: string): string {
  if (status.startsWith("Signaling connected:")) {
    const code = status.split(":")[1]?.trim();
    return code ? `Signaling online. Room ${code} registered.` : "Signaling online. Room registered.";
  }
  if (status === "P2P channel opening") {
    return "P2P connection establishing...";
  }
  if (status === "P2P channel not ready yet") {
    return "Packet queued. P2P channel opening...";
  }
  if (status === "P2P data channel open") {
    return "P2P ready. Data channel open.";
  }
  if (status === "P2P data channel closed") {
    return "P2P closed. Connection ended.";
  }
  if (status === "connecting") {
    return "Peer handshake in progress...";
  }
  if (status === "connected") {
    return "Peer link connected.";
  }
  if (status === "disconnected") {
    return "Peer link interrupted. Reconnecting...";
  }
  if (status === "failed") {
    return "Peer link failed. Create or join again.";
  }
  if (status === "closed") {
    return "Peer link closed.";
  }
  return status;
}

function getPresenceSessionId(): string {
  const stored = localStorage.getItem(presenceSessionKey);
  if (stored) {
    return stored;
  }
  const sessionId = crypto.randomUUID();
  localStorage.setItem(presenceSessionKey, sessionId);
  return sessionId;
}

function driftBoardWithStorm(board: BoardState): { board: BoardState; moved: boolean } {
  const candidates = board.ships.flatMap((ship) => {
    if (ship.hits.length > 0) {
      return [];
    }
    return [
      { row: ship.origin.row - 1, col: ship.origin.col },
      { row: ship.origin.row + 1, col: ship.origin.col },
      { row: ship.origin.row, col: ship.origin.col - 1 },
      { row: ship.origin.row, col: ship.origin.col + 1 }
    ]
      .filter((origin) => {
        const cells = getShipCells({ ...ship, origin });
        return cells.every((cell) => !board.shots[coordKey(cell)]) && canPlaceShip(board, ship, origin, ship.orientation, ship.id);
      })
      .map((origin) => ({ ship, origin }));
  });

  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  if (!pick) {
    return { board, moved: false };
  }
  return { board: placeShip(board, pick.ship, pick.origin, pick.ship.orientation), moved: true };
}

type MatchMode = "practice" | "p2p";
type PeerRole = "host" | "guest" | null;
type BattleBoardView = "target" | "fleet";
type StormPhase = "clear" | "warning" | "wave";
type AudioMode = "on" | "music-muted" | "muted";
const BOARD_SWITCH_DELAY_MS = 300;
const BOARD_RETURN_DELAY_MS = 1200;
const OPPONENT_SOUND_VOLUME = 0.28;
const audioModeKey = "sea-battle.audio-mode";
const presenceSessionKey = "sea-battle.presence-session";
const waitingFrames = ["Waiting", "Waiting.", "Waiting..", "Waiting...", "Waiting..", "Waiting."];

interface ReadyPayload {
  board: BoardState;
}

interface ShotPayload {
  coord: Coordinate;
}

interface ShotResultPayload {
  coord: Coordinate;
  result: ShotResult;
  board?: BoardState;
  shipId?: string;
  nextTurn: "local" | "remote";
  winner: "local" | "remote" | null;
  attackerShield?: number;
  defenderShield?: number;
  treasureKind?: "shield" | "fake";
  chaosMessage?: string;
}

interface StormBoardPayload {
  board: BoardState;
}

function App() {
  const [profile, setProfile] = useState<PlayerProfile>(() => loadProfile());
  const [stats, setStats] = useState<PlayerStats>(() => loadStats());
  const [game, setGame] = useState(() => createInitialGame(defaultSettings));
  const [orientation, setOrientation] = useState<Orientation>("horizontal");
  const [hovered, setHovered] = useState<Coordinate | null>(null);
  const [activeTab, setActiveTab] = useState<"play" | "profile" | "stats" | "lobby" | "achievements">("play");
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [networkStatus, setNetworkStatus] = useState("Offline practice");
  const [waitingFrame, setWaitingFrame] = useState(0);
  const [opponent, setOpponent] = useState<PeerIdentity>(guestIdentity);
  const [clock, setClock] = useState<number>(defaultSettings.blitz.seconds);
  const clockRef = useRef(clock);
  const [showOpponentStats, setShowOpponentStats] = useState(false);
  const [attackVisual, setAttackVisual] = useState<(AttackAnimation & { board: "local" | "remote" }) | null>(null);
  const [matchMode, setMatchMode] = useState<MatchMode>("practice");
  const [peerRole, setPeerRole] = useState<PeerRole>(null);
  const [localReady, setLocalReady] = useState(false);
  const [remoteReady, setRemoteReady] = useState(false);
  const [remoteBoardReady, setRemoteBoardReady] = useState<BoardState | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<Coordinate | null>(null);
  const [battleBoardView, setBattleBoardView] = useState<BattleBoardView>("target");
  const [appVersion, setAppVersion] = useState<AppVersion | null>(null);
  const [copyNotice, setCopyNotice] = useState("");
  const [eventToast, setEventToast] = useState("");
  const [achievementToast, setAchievementToast] = useState<AchievementDefinition | null>(null);
  const [stormPhase, setStormPhase] = useState<StormPhase>("clear");
  const [localShield, setLocalShield] = useState(0);
  const [remoteShield, setRemoteShield] = useState(0);
  const [placementBoardExpanded, setPlacementBoardExpanded] = useState(false);
  const [openLobbies, setOpenLobbies] = useState<LobbySummary[]>([]);
  const [presenceStatus, setPresenceStatus] = useState<PresenceStatus>({ onlinePlayers: 1, activeGames: 0, lobbies: [] });
  const [audioMode, setAudioMode] = useState<AudioMode>(() => (localStorage.getItem(audioModeKey) as AudioMode | null) ?? "on");
  const network = useRef<PeerGameClient | null>(null);
  const gameRef = useRef(game);
  const peerRoleRef = useRef<PeerRole>(null);
  const opponentRef = useRef(opponent);
  const remoteBoardReadyRef = useRef<BoardState | null>(null);
  const localShieldRef = useRef(localShield);
  const remoteShieldRef = useRef(remoteShield);
  const boardSwitchTimer = useRef<number | null>(null);
  const boardReturnTimer = useRef<number | null>(null);
  const copyNoticeTimer = useRef<number | null>(null);
  const eventToastTimer = useRef<number | null>(null);
  const lastEventToast = useRef<{ message: string; at: number }>({ message: "", at: 0 });
  const achievementToastTimer = useRef<number | null>(null);
  const stormTimer = useRef<number | null>(null);
  const stormClearTimer = useRef<number | null>(null);
  const lastStormMove = useRef(-1);
  const matchRecordedRef = useRef(false);

  const config = useMemo(() => getBoardConfig(game.settings.boardId), [game.settings.boardId]);
  const selectedShip = config.fleet.find((ship) => ship.id === game.selectedShipId);
  const placedIds = useMemo(() => new Set(game.localBoard.ships.map((ship) => ship.id)), [game.localBoard.ships]);
  const placementReady = game.localBoard.ships.length === config.fleet.length;
  const opponentRecord = stats.opponents[opponent.playerId];
  const matchActive = game.phase === "battle" || game.phase === "victory" || game.phase === "defeat";
  const enemyShipsSunk = useMemo(() => game.remoteBoard.ships.filter(isShipSunk).length, [game.remoteBoard.ships]);
  const localShipsSunk = useMemo(() => game.localBoard.ships.filter(isShipSunk).length, [game.localBoard.ships]);
  const enemyShipsLeft = Math.max(0, game.remoteBoard.ships.length - enemyShipsSunk);
  const localShipsLeft = Math.max(0, game.localBoard.ships.length - localShipsSunk);
  const shareLink = useMemo(() => makeShareLink(roomCode), [roomCode]);
  const lobbyOpponent = opponent.playerId === guestIdentity.playerId ? waitingIdentity : opponent;
  const waitingLabel = waitingFrames[waitingFrame];
  const leadingSide: "local" | "remote" | null =
    enemyShipsSunk === localShipsSunk ? null : enemyShipsSunk > localShipsSunk ? "local" : "remote";
  const battleLeadLabel = leadingSide === "local" ? profile.displayName : leadingSide === "remote" ? opponent.displayName : "tied";
  const leadDifference = Math.abs(enemyShipsSunk - localShipsSunk);
  const crownScale = leadingSide === "remote" ? 0.88 : leadingSide === "local" ? 1 + Math.min(leadDifference, 8) * 0.045 : 1;
  const preview = useMemo(
    () =>
      hovered && selectedShip && game.phase === "placing"
        ? {
            cells: getShipCells({ ...selectedShip, origin: hovered, orientation }),
            valid: canPlaceShip(game.localBoard, selectedShip, hovered, orientation, selectedShip.id)
          }
        : null,
    [game.localBoard, game.phase, hovered, orientation, selectedShip]
  );

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  useEffect(() => {
    peerRoleRef.current = peerRole;
  }, [peerRole]);

  useEffect(() => {
    opponentRef.current = opponent;
  }, [opponent]);

  useEffect(() => {
    remoteBoardReadyRef.current = remoteBoardReady;
  }, [remoteBoardReady]);

  useEffect(() => {
    localShieldRef.current = localShield;
  }, [localShield]);

  useEffect(() => {
    remoteShieldRef.current = remoteShield;
  }, [remoteShield]);

  useEffect(() => {
    const shouldAnimateWaiting = matchMode === "p2p" && game.phase === "placing" && (!remoteReady || /Waiting/.test(networkStatus));
    if (!shouldAnimateWaiting) {
      setWaitingFrame(0);
      return;
    }
    const interval = window.setInterval(() => {
      setWaitingFrame((value) => (value + 1) % waitingFrames.length);
    }, 480);
    return () => window.clearInterval(interval);
  }, [game.phase, matchMode, networkStatus, remoteReady]);

  function attackDirection(coord: Coordinate): AttackAnimation["direction"] {
    const top = coord.row;
    const bottom = config.size - coord.row - 1;
    const left = coord.col;
    const right = config.size - coord.col - 1;
    const edge = Math.min(top, bottom, left, right);
    if (edge === left) {
      return "left-right";
    }
    if (edge === right) {
      return "right-left";
    }
    if (edge === top) {
      return "top-bottom";
    }
    return "bottom-top";
  }

  function playAttackVisual(board: "local" | "remote", coord: Coordinate, result: AttackAnimation["result"], volume = 1) {
    audio.play("flyby", volume);
    setAttackVisual({
      id: crypto.randomUUID(),
      board,
      coord,
      direction: attackDirection(coord),
      result
    });
    window.setTimeout(() => setAttackVisual((current) => (current?.coord === coord && current.board === board ? null : current)), 920);
  }

  function notifyLocalTurn(): void {
    audio.play("turn", 0.8);
  }

  function playShotResultSound(result: ShotResult, volume = 1): void {
    if (result === "miss" || result === "shielded") {
      audio.play("miss", volume);
      return;
    }
    audio.play("whizz-hit", volume);
    audio.play("hit", volume);
  }

  async function copyToClipboard(value: string): Promise<void> {
    if (!value) {
      return;
    }
    try {
      await navigator.clipboard?.writeText(value);
    } catch {
      // The toast is still useful feedback if a browser blocks clipboard access.
    }
    setCopyNotice("Copied!");
    if (copyNoticeTimer.current !== null) {
      window.clearTimeout(copyNoticeTimer.current);
    }
    copyNoticeTimer.current = window.setTimeout(() => {
      copyNoticeTimer.current = null;
      setCopyNotice("");
    }, 1400);
  }

  function showAchievementToast(achievement: AchievementDefinition) {
    setAchievementToast(achievement);
    if (achievementToastTimer.current !== null) {
      window.clearTimeout(achievementToastTimer.current);
    }
    achievementToastTimer.current = window.setTimeout(() => {
      achievementToastTimer.current = null;
      setAchievementToast(null);
    }, 2600);
  }

  function showEventToast(message: string) {
    const now = performance.now();
    if (lastEventToast.current.message === message && now - lastEventToast.current.at < 1500) {
      return;
    }
    lastEventToast.current = { message, at: now };
    setEventToast(message);
    if (eventToastTimer.current !== null) {
      window.clearTimeout(eventToastTimer.current);
    }
    eventToastTimer.current = window.setTimeout(() => {
      eventToastTimer.current = null;
      setEventToast("");
    }, 2200);
  }

  function unlockLocalAchievement(achievementId: string) {
    setStats((current) => {
      const result = unlockAchievement(current, achievementId);
      if (result.unlocked) {
        showAchievementToast(result.unlocked);
      }
      return result.stats;
    });
  }

  function showBattleBoard(view: BattleBoardView, holdMs = 0, delayMs = 0) {
    if (boardSwitchTimer.current !== null) {
      window.clearTimeout(boardSwitchTimer.current);
      boardSwitchTimer.current = null;
    }
    if (boardReturnTimer.current !== null) {
      window.clearTimeout(boardReturnTimer.current);
      boardReturnTimer.current = null;
    }
    if (delayMs > 0) {
      boardSwitchTimer.current = window.setTimeout(() => {
        boardSwitchTimer.current = null;
        showBattleBoard(view, holdMs);
      }, delayMs);
      return;
    }
    setBattleBoardView(view);
    if (holdMs > 0) {
      boardReturnTimer.current = window.setTimeout(() => {
        boardReturnTimer.current = null;
        const current = gameRef.current;
        if (current.phase === "battle" && current.turn === "local") {
          setBattleBoardView("target");
        }
      }, holdMs);
    }
  }

  function setGameAfterImpact(nextState: GameState, holdTurn: PlayerSide): void {
    if (nextState.phase !== "battle" || nextState.winner || nextState.turn === holdTurn) {
      setGame(nextState);
      return;
    }

    setGame({ ...nextState, turn: holdTurn });
    window.setTimeout(() => {
      setGame((current) => (current.phase === "battle" && current.moves === nextState.moves ? { ...current, turn: nextState.turn } : current));
    }, BOARD_SWITCH_DELAY_MS);
  }

  useEffect(() => {
    assets.preload();
  }, []);

  useEffect(() => {
    void loadAppVersion().then(setAppVersion);
  }, []);

  useEffect(() => {
    const sessionId = getPresenceSessionId();
    let active = true;

    async function updatePresence() {
      const status = await pingPresence(sessionId);
      if (!active) {
        return;
      }
      setPresenceStatus(status);
      setOpenLobbies(status.lobbies);
    }

    void updatePresence();
    const interval = window.setInterval(() => void updatePresence(), 20000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void updatePresence();
      }
    };
    const handleUnload = () => leavePresence(sessionId);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handleUnload);

    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handleUnload);
      leavePresence(sessionId);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (copyNoticeTimer.current !== null) {
        window.clearTimeout(copyNoticeTimer.current);
      }
      if (achievementToastTimer.current !== null) {
        window.clearTimeout(achievementToastTimer.current);
      }
      if (eventToastTimer.current !== null) {
        window.clearTimeout(eventToastTimer.current);
      }
      if (stormTimer.current !== null) {
        window.clearTimeout(stormTimer.current);
      }
      if (stormClearTimer.current !== null) {
        window.clearTimeout(stormClearTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedRoom = (params.get("room") ?? params.get("join") ?? "").trim().toUpperCase();
    if (!sharedRoom) {
      return;
    }
    setJoinCode(sharedRoom);
    setRoomCode(sharedRoom);
    setActiveTab("play");
    void joinRoom(sharedRoom);
  }, []);

  useEffect(() => {
    saveProfile(profile);
  }, [profile]);

  useEffect(() => {
    saveStats(stats);
  }, [stats]);

  useEffect(() => {
    localStorage.setItem(audioModeKey, audioMode);
    audio.setEffectsEnabled(audioMode !== "muted");
    audio.setMusicEnabled(audioMode === "on");
  }, [audioMode]);

  useEffect(() => {
    if (game.phase === "battle" && audioMode === "on") {
      void audio.playTheme();
      return;
    }
    audio.stopTheme();
  }, [audioMode, game.phase]);

  useEffect(() => {
    if (activeTab === "lobby") {
      void refreshOpenLobbies();
    }
  }, [activeTab]);

  useEffect(() => {
    if (game.phase !== "battle" || !game.settings.blitz.enabled) {
      return;
    }
    const interval = window.setInterval(() => {
      const next = Math.max(0, clockRef.current - 0.25);
      clockRef.current = next;
      setClock((value) => (Math.ceil(next) === Math.ceil(value) ? value : next));
    }, 250);
    return () => window.clearInterval(interval);
  }, [game.phase, game.settings.blitz.enabled]);

  useEffect(() => {
    if (game.phase === "battle") {
      clockRef.current = game.settings.blitz.seconds;
      setClock(game.settings.blitz.seconds);
    }
  }, [game.turn, game.phase, game.settings.blitz.seconds]);

  useEffect(() => {
    if (game.phase !== "battle" || !game.settings.modifiers.stormMode || game.moves === 0 || game.moves % 6 !== 0 || lastStormMove.current === game.moves) {
      return;
    }
    lastStormMove.current = game.moves;
    setStormPhase("warning");
    audio.play("storm-warn", 0.8);
    if (stormTimer.current !== null) {
      window.clearTimeout(stormTimer.current);
    }
    stormTimer.current = window.setTimeout(() => {
      stormTimer.current = null;
      setStormPhase("wave");
      audio.play("storm-wave", 0.9);
      setGame((current) => {
        if (current.phase !== "battle") {
          return current;
        }
        const localStorm = driftBoardWithStorm(current.localBoard);
        const remoteStorm = matchMode === "practice" ? driftBoardWithStorm(current.remoteBoard) : { board: current.remoteBoard, moved: false };
        if (localStorm.moved) {
          unlockLocalAchievement("storm_chaser");
          network.current?.send("storm-board", { board: localStorm.board } satisfies StormBoardPayload);
        }
        return {
          ...current,
          localBoard: localStorm.board,
          remoteBoard: remoteStorm.board
        };
      });
      if (stormClearTimer.current !== null) {
        window.clearTimeout(stormClearTimer.current);
      }
      stormClearTimer.current = window.setTimeout(() => {
        stormClearTimer.current = null;
        setStormPhase("clear");
      }, 1400);
    }, 10000);
  }, [game.moves, game.phase, game.settings.modifiers.stormMode, matchMode]);

  useEffect(() => {
    if (game.phase !== "battle") {
      setSelectedTarget(null);
      setBattleBoardView("target");
      return;
    }
    if (game.turn === "remote") {
      setBattleBoardView("fleet");
    }
  }, [game.phase, game.turn]);

  useEffect(() => {
    if (clock > 0 || game.phase !== "battle" || !game.settings.blitz.enabled) {
      return;
    }
    if (game.settings.blitz.timeoutAction === "lose-match") {
      const result = game.turn === "local" ? "loss" : "win";
      endMatch(result);
      setGame((current) => ({ ...current, phase: game.turn === "local" ? "defeat" : "victory", winner: game.turn === "local" ? "remote" : "local" }));
    } else {
      setGame((current) => {
        const nextTurn = current.turn === "local" ? "remote" : "local";
        if (nextTurn === "local") {
          notifyLocalTurn();
        }
        return { ...current, turn: nextTurn };
      });
    }
  }, [clock, game.phase, game.settings.blitz.enabled, game.settings.blitz.timeoutAction, game.turn]);

  function updateSettings(settings: GameSettings) {
    const nextSettings = normalizeSettings(settings);
    setLocalReady(false);
    setRemoteReady(false);
    setRemoteBoardReady(null);
    setLocalShield(0);
    setRemoteShield(0);
    setGame((current) => ({
      ...resetBoards(current, nextSettings),
      localBoard: createBoardForSettings(nextSettings),
      selectedShipId: null
    }));
    if (matchMode === "p2p" && peerRole === "host") {
      network.current?.send("settings", nextSettings);
    }
  }

  const placeSelectedShip = useCallback((coord: Coordinate) => {
    if (game.phase !== "placing" || localReady) {
      return;
    }

    const placedShip = findShipAt(game.localBoard, coord);
    if (placedShip) {
      const nextOrientation = placedShip.orientation === "horizontal" ? "vertical" : "horizontal";
      if (canPlaceShip(game.localBoard, placedShip, placedShip.origin, nextOrientation, placedShip.id)) {
        setOrientation(nextOrientation);
        setGame((current) => ({
          ...current,
          localBoard: placeShip(current.localBoard, placedShip, placedShip.origin, nextOrientation),
          selectedShipId: placedShip.id
        }));
      } else {
        setOrientation(placedShip.orientation);
        setGame((current) => ({ ...current, selectedShipId: placedShip.id }));
      }
      return;
    }

    if (!selectedShip) {
      return;
    }

    setGame((current) => {
      const board = placeShip(current.localBoard, selectedShip, coord, orientation);
      const nextSelected = nextUnplacedShipId(current.settings, new Set(board.ships.map((ship) => ship.id)));
      return {
        ...current,
        localBoard: board,
        selectedShipId: nextSelected
      };
    });
  }, [game.localBoard, game.phase, localReady, orientation, selectedShip]);

  function shuffle() {
    const board = createBoardForSettings(game.settings);
    setLocalReady(false);
    setLocalShield(0);
    setRemoteShield(0);
    setGame((current) => ({ ...current, localBoard: board, selectedShipId: nextUnplacedShipId(current.settings, new Set(board.ships.map((ship) => ship.id))) }));
  }

  function beginLocalBattle() {
    const remoteBoard = createBoardForSettings(game.settings);
    matchRecordedRef.current = false;
    setLocalShield(0);
    setRemoteShield(0);
    setMatchMode("practice");
    setOpponent(guestIdentity);
    setGame((current) => startBattle(current, remoteBoard));
  }

  const selectTarget = useCallback((coord: Coordinate) => {
    if (game.phase !== "battle" || game.turn !== "local") {
      return;
    }
    if (hasBlockingShot(game.remoteBoard, coord) || isSunkBufferCoord(game.remoteBoard, coord)) {
      return;
    }
    setSelectedTarget(coord);
  }, [game.phase, game.remoteBoard, game.turn]);

  const fireSelectedTarget = useCallback(() => {
    if (!selectedTarget) {
      return;
    }
    if (hasBlockingShot(game.remoteBoard, selectedTarget) || isSunkBufferCoord(game.remoteBoard, selectedTarget)) {
      setSelectedTarget(null);
      return;
    }
    fire(selectedTarget);
  }, [game.remoteBoard, selectedTarget]);

  function sameCoord(left: Coordinate, right: Coordinate): boolean {
    return left.row === right.row && left.col === right.col;
  }

  function availableChaosTargets(board: BoardState, coord: Coordinate): Coordinate[] {
    return [
      { row: coord.row - 1, col: coord.col },
      { row: coord.row + 1, col: coord.col },
      { row: coord.row, col: coord.col - 1 },
      { row: coord.row, col: coord.col + 1 }
    ].filter((candidate) => (
      candidate.row >= 0 &&
      candidate.col >= 0 &&
      candidate.row < board.size &&
      candidate.col < board.size &&
      !hasBlockingShot(board, candidate) &&
      !isSunkBufferCoord(board, candidate)
    ));
  }

  function applyPirateChaos(coord: Coordinate, board: BoardState): { coord: Coordinate; message?: string } {
    if (!game.settings.modifiers.pirateChaos) {
      return { coord };
    }
    const options = availableChaosTargets(board, coord);
    if (!options.length) {
      return { coord };
    }

    const roll = Math.random();
    if (roll < 0.14) {
      return {
        coord: options[Math.floor(Math.random() * options.length)],
        message: "Rum fog wobbled your aim."
      };
    }
    if (roll < 0.34) {
      return {
        coord: options[Math.floor(Math.random() * options.length)],
        message: "Cursed cannonball curved!"
      };
    }

    return { coord };
  }

  useEffect(() => {
    function handleFireShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (isTyping || (event.key !== "Enter" && event.key !== " ")) {
        return;
      }
      if (gameRef.current.phase !== "battle" || gameRef.current.turn !== "local" || battleBoardView !== "target" || !selectedTarget) {
        return;
      }
      event.preventDefault();
      fireSelectedTarget();
    }

    window.addEventListener("keydown", handleFireShortcut);
    return () => window.removeEventListener("keydown", handleFireShortcut);
  }, [battleBoardView, fireSelectedTarget, selectedTarget]);

  function fire(coord: Coordinate) {
    if (game.turn !== "local") {
      return;
    }
    const chaos = applyPirateChaos(coord, game.remoteBoard);
    const finalCoord = chaos.coord;
    const treasure = findTreasureAt(game.remoteBoard, finalCoord);
    if (treasure) {
      const remoteBoard = markTreasureShot(game.remoteBoard, finalCoord);
      const nextLocalShield = treasure === "shield" ? localShield + 1 : localShield;
      if (treasure === "shield") {
        setLocalShield(nextLocalShield);
        showEventToast(`${chaos.message && !sameCoord(coord, finalCoord) ? `${chaos.message} ` : ""}Treasure found: one-hit shield armed.`);
      } else {
        showEventToast(`${chaos.message && !sameCoord(coord, finalCoord) ? `${chaos.message} ` : ""}Fake treasure! You got faked out.`);
      }
      const state: GameState = {
        ...game,
        remoteBoard,
        turn: "remote",
        moves: game.moves + 1,
        log: [`local ${treasure === "shield" ? "TREASURE" : "FAKE TREASURE"} at ${finalCoord.row + 1},${finalCoord.col + 1}`, ...game.log].slice(0, 30)
      };
      setSelectedTarget(null);
      showBattleBoard("fleet", BOARD_RETURN_DELAY_MS, BOARD_SWITCH_DELAY_MS);
      playAttackVisual("remote", finalCoord, "miss");
      playShotResultSound("miss");
      setGameAfterImpact(state, game.turn);
      setStats((current) => awardXp({ ...current, totalShots: current.totalShots + 1 }, xpAwards.shot));
      network.current?.send("shot", { coord: finalCoord } satisfies ShotPayload);
      if (matchMode === "practice") {
        window.setTimeout(() => remoteTurn(state), 450);
      }
      return;
    }

    const protectedShip = remoteShield > 0 ? findShipAt(game.remoteBoard, finalCoord) : undefined;
    if (protectedShip) {
      const remoteBoard = markShieldedShot(game.remoteBoard, finalCoord);
      const nextRemoteShield = Math.max(0, remoteShield - 1);
      setRemoteShield(nextRemoteShield);
      showEventToast(`${chaos.message && !sameCoord(coord, finalCoord) ? `${chaos.message} ` : ""}Shield blocked the hit.`);
      const state: GameState = {
        ...game,
        remoteBoard,
        turn: "remote",
        moves: game.moves + 1,
        log: [`local SHIELDED at ${finalCoord.row + 1},${finalCoord.col + 1}`, ...game.log].slice(0, 30)
      };
      setSelectedTarget(null);
      showBattleBoard("fleet", BOARD_RETURN_DELAY_MS, BOARD_SWITCH_DELAY_MS);
      playAttackVisual("remote", finalCoord, "shielded");
      playShotResultSound("shielded");
      setGameAfterImpact(state, game.turn);
      setStats((current) => awardXp({ ...current, totalShots: current.totalShots + 1 }, xpAwards.shot));
      network.current?.send("shot", { coord: finalCoord } satisfies ShotPayload);
      if (matchMode === "practice") {
        window.setTimeout(() => remoteTurn(state), 450);
      }
      return;
    }

    const { state, outcome } = attack(game, "remote", finalCoord);
    if (outcome.result === "invalid" || outcome.result === "duplicate") {
      return;
    }
    if (chaos.message && !sameCoord(coord, finalCoord)) {
      showEventToast(chaos.message);
    }
    setSelectedTarget(null);
    showBattleBoard(
      outcome.nextTurn === "local" ? "target" : "fleet",
      outcome.nextTurn === "remote" ? BOARD_RETURN_DELAY_MS : 0,
      outcome.nextTurn === "remote" ? BOARD_SWITCH_DELAY_MS : 0
    );
    playAttackVisual("remote", finalCoord, outcome.result);
    playShotResultSound(outcome.result);
    setGameAfterImpact(state, game.turn);
    setStats((current) =>
      awardXp(
        {
          ...current,
          totalShots: current.totalShots + 1,
          hits: current.hits + (outcome.result === "miss" ? 0 : 1),
          shipsDestroyed: current.shipsDestroyed + (outcome.result === "sunk" ? 1 : 0)
        },
        xpForShot(outcome.result)
      )
    );
    if (outcome.result === "hit" || outcome.result === "sunk") {
      unlockLocalAchievement("first_hit");
      if (game.settings.modifiers.fogTide) {
        unlockLocalAchievement("fog_hit");
      }
    }
    if (outcome.result === "sunk") {
      unlockLocalAchievement("first_sink");
    }
    network.current?.send("shot", { coord: finalCoord } satisfies ShotPayload);
    if (outcome.winner) {
      endMatch("win", state);
      return;
    }
    if (matchMode === "practice" && outcome.nextTurn === "remote") {
      window.setTimeout(() => remoteTurn(state), 450);
    }
  }

  function remoteTurn(currentGame = game) {
    const pick = pickOpenShot(currentGame.localBoard);
    if (!pick) {
      return;
    }
    const treasure = findTreasureAt(currentGame.localBoard, pick);
    if (treasure) {
      const localBoard = markTreasureShot(currentGame.localBoard, pick);
      if (treasure === "shield") {
        setRemoteShield((value) => value + 1);
      }
      const state: GameState = {
        ...currentGame,
        localBoard,
        turn: "local",
        moves: currentGame.moves + 1,
        log: [`remote ${treasure === "shield" ? "TREASURE" : "FAKE TREASURE"} at ${pick.row + 1},${pick.col + 1}`, ...currentGame.log].slice(0, 30)
      };
      playAttackVisual("local", pick, "miss", OPPONENT_SOUND_VOLUME);
      playShotResultSound("miss", OPPONENT_SOUND_VOLUME);
      showBattleBoard("target", 0, BOARD_SWITCH_DELAY_MS);
      setGameAfterImpact(state, currentGame.turn);
      notifyLocalTurn();
      return;
    }

    const protectedShip = localShield > 0 ? findShipAt(currentGame.localBoard, pick) : undefined;
    if (protectedShip) {
      setLocalShield((value) => Math.max(0, value - 1));
      showEventToast("Your shield blocked a hit.");
      const state: GameState = {
        ...currentGame,
        localBoard: markShieldedShot(currentGame.localBoard, pick),
        turn: "local",
        moves: currentGame.moves + 1,
        log: [`remote SHIELDED at ${pick.row + 1},${pick.col + 1}`, ...currentGame.log].slice(0, 30)
      };
      playAttackVisual("local", pick, "shielded", OPPONENT_SOUND_VOLUME);
      playShotResultSound("shielded", OPPONENT_SOUND_VOLUME);
      showBattleBoard("target", 0, BOARD_SWITCH_DELAY_MS);
      setGameAfterImpact(state, currentGame.turn);
      notifyLocalTurn();
      return;
    }

    const { state, outcome } = attack(currentGame, "local", pick);
    if (outcome.result !== "invalid" && outcome.result !== "duplicate") {
      playAttackVisual("local", pick, outcome.result, OPPONENT_SOUND_VOLUME);
      playShotResultSound(outcome.result, OPPONENT_SOUND_VOLUME);
      showBattleBoard(outcome.nextTurn === "local" ? "target" : "fleet", 0, outcome.nextTurn === "local" ? BOARD_SWITCH_DELAY_MS : 0);
    }
    setGameAfterImpact(state, currentGame.turn);
    if (outcome.winner) {
      endMatch("loss", state);
      return;
    }
    if (outcome.nextTurn === "remote") {
      window.setTimeout(() => remoteTurn(state), 520);
    } else {
      notifyLocalTurn();
    }
  }

  function endMatch(result: "win" | "loss", state = game) {
    if (matchRecordedRef.current) {
      return;
    }
    matchRecordedRef.current = true;
    audio.play(result === "win" ? "victory" : "defeat");
    if (result === "win") {
      unlockLocalAchievement("first_win");
    }
    const durationMs = Math.round((state.endedAt ?? performance.now()) - (state.startedAt ?? performance.now()));
    setStats((current) =>
      recordMatch(current, {
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
        opponent,
        boardSize: config.size,
        mode: state.settings.blitz.enabled ? "Blitz" : "Classic",
        result,
        moves: state.moves,
        durationMs
      })
    );
  }

  function leaveOrForfeit() {
    const current = gameRef.current;
    const forfeitingBattle = matchMode === "p2p" && current.phase === "battle";
    network.current?.send("forfeit", { phase: current.phase });
    network.current?.close();
    network.current = null;
    setPeerRole(null);
    setMatchMode("practice");
    setOpponent(guestIdentity);
    setLocalReady(false);
    setRemoteReady(false);
    setRemoteBoardReady(null);
    setRoomCode("");
    setJoinCode("");
    setNetworkStatus("P2P closed. Offline practice ready.");
    setBattleBoardView("target");
    setSelectedTarget(null);
    if (forfeitingBattle) {
      const nextState: GameState = {
        ...current,
        phase: "defeat",
        winner: "remote",
        endedAt: performance.now()
      };
      setGame(nextState);
      endMatch("loss", nextState);
      return;
    }
    setGame((latest) => resetBoards(latest, latest.settings));
  }

  async function createRoom() {
    if (network.current) {
      network.current.close();
    }
    const client = new PeerGameClient();
    network.current = client;
    setMatchMode("p2p");
    setPeerRole("host");
    setOpponent(waitingIdentity);
    setNetworkStatus("Opening P2P room...");
    setLocalReady(false);
    setRemoteReady(false);
    setRemoteBoardReady(null);
    bindPeerClient(client);
    client.onStatus((status) => {
      setNetworkStatus(formatNetworkStatus(status));
      if (status === "P2P data channel open") {
        client.send("identity", makeIdentity(profile, stats));
        client.send("settings", gameRef.current.settings);
      }
    });
    const code = await client.createRoom(makeIdentity(profile, stats));
    setRoomCode(code);
    setNetworkStatus(`Room ${code} ready. Waiting for opponent...`);
    void refreshOpenLobbies();
    updateSettings(game.settings);
    setActiveTab("play");
  }

  async function refreshOpenLobbies(): Promise<void> {
    const status = await fetchPresenceStatus();
    setPresenceStatus(status);
    setOpenLobbies(status.lobbies);
  }

  async function joinRoom(roomCodeOverride = joinCode) {
    const codeToJoin = roomCodeOverride.trim().toUpperCase();
    if (!codeToJoin) {
      return;
    }
    if (network.current) {
      network.current.close();
    }
    const client = new PeerGameClient();
    network.current = client;
    setMatchMode("p2p");
    setPeerRole("guest");
    setOpponent(waitingIdentity);
    setNetworkStatus(`Joining room ${codeToJoin}...`);
    setLocalReady(false);
    setRemoteReady(false);
    setRemoteBoardReady(null);
    bindPeerClient(client);
    client.onStatus((status) => {
      setNetworkStatus(formatNetworkStatus(status));
      if (status === "P2P data channel open") {
        client.send("identity", makeIdentity(profile, stats));
      }
    });
    setJoinCode(codeToJoin);
    await client.joinRoom(codeToJoin, makeIdentity(profile, stats));
    setRoomCode(codeToJoin);
    setActiveTab("play");
  }

  function bindPeerClient(client: PeerGameClient) {
    client.onMessage((message) => {
      if (message.type === "identity") {
        const remote = message.payload as PeerIdentity;
        if (remote.displayName.trim().toLowerCase() === profile.displayName.trim().toLowerCase()) {
          setNetworkStatus("Duplicate display name. Change one name before connecting.");
          client.close();
          return;
        }
        setOpponent(remote);
        return;
      }

      if (message.type === "settings") {
        const settings = normalizeSettings(message.payload as GameSettings);
        setGame((current) => ({
          ...resetBoards(current, settings),
          localBoard: createBoardForSettings(settings),
          selectedShipId: null
        }));
        setLocalReady(false);
        setRemoteReady(false);
        setRemoteBoardReady(null);
        setLocalShield(0);
        setRemoteShield(0);
        setActiveTab("play");
        setNetworkStatus("Host settings received. Ready your fleet.");
        return;
      }

      if (message.type === "storm-board") {
        const payload = message.payload as StormBoardPayload;
        setGame((current) => ({ ...current, remoteBoard: payload.board }));
        return;
      }

      if (message.type === "ready") {
        const payload = message.payload as ReadyPayload;
        audio.play("turn", 0.45);
        setRemoteBoardReady(payload.board);
        setRemoteReady(true);
        setGame((current) => ({ ...current, remoteBoard: payload.board }));
        setNetworkStatus(peerRoleRef.current === "host" ? "Opponent ready. Start P2P Battle." : "Host ready. Waiting for launch...");
        return;
      }

      if (message.type === "start") {
        matchRecordedRef.current = false;
        setGame((current) => ({ ...startBattle(current, remoteBoardReadyRef.current ?? current.remoteBoard), turn: "remote" }));
        setNetworkStatus("Battle live. Host fires first.");
        setActiveTab("play");
        return;
      }

      if (message.type === "forfeit") {
        const current = gameRef.current;
        if (current.phase === "battle") {
          const nextState: GameState = {
            ...current,
            phase: "victory",
            winner: "local",
            endedAt: performance.now()
          };
          setGame(nextState);
          endMatch("win", nextState);
        }
        setNetworkStatus("Peer left. Match closed.");
        return;
      }

      if (message.type === "shot") {
        const payload = message.payload as ShotPayload | Coordinate;
        const coord = "coord" in payload ? payload.coord : payload;
        receiveRemoteShot(coord);
        return;
      }

      if (message.type === "shot-result") {
        applyRemoteShotResult(message.payload as ShotResultPayload);
      }
    });
  }

  function markReady() {
    if (!placementReady || matchMode !== "p2p") {
      return;
    }
    audio.play("turn", 0.45);
    setLocalReady(true);
    setNetworkStatus(remoteReady ? "Both fleets ready. Standing by for launch." : "Fleet locked. Waiting for opponent...");
    network.current?.send("ready", { board: game.localBoard } satisfies ReadyPayload);
  }

  function startP2PBattle() {
    if (peerRole !== "host" || !localReady || !remoteReady || !remoteBoardReady) {
      return;
    }
    matchRecordedRef.current = false;
    setGame((current) => startBattle({ ...current, remoteBoard: remoteBoardReady }, remoteBoardReady));
    network.current?.send("start", { startedAt: Date.now() });
    setNetworkStatus("Battle live. Your turn.");
    setActiveTab("play");
  }

  function receiveRemoteShot(coord: Coordinate) {
    const current = gameRef.current;
    const treasure = findTreasureAt(current.localBoard, coord);
    if (treasure) {
      const board = markTreasureShot(current.localBoard, coord);
      const nextRemoteShield = treasure === "shield" ? remoteShieldRef.current + 1 : remoteShieldRef.current;
      if (treasure === "shield") {
        setRemoteShield(nextRemoteShield);
      }
      playAttackVisual("local", coord, "miss", OPPONENT_SOUND_VOLUME);
      playShotResultSound("miss", OPPONENT_SOUND_VOLUME);
      const nextState: GameState = {
        ...current,
        localBoard: board,
        turn: "local",
        moves: current.moves + 1,
        log: [`remote ${treasure === "shield" ? "TREASURE" : "FAKE TREASURE"} at ${coord.row + 1},${coord.col + 1}`, ...current.log].slice(0, 30)
      };
      showBattleBoard("target", 0, BOARD_SWITCH_DELAY_MS);
      setGameAfterImpact(nextState, current.turn);
      network.current?.send("shot-result", {
        coord,
        result: "miss",
        board,
        nextTurn: "local",
        winner: null,
        attackerShield: nextRemoteShield,
        treasureKind: treasure
      } satisfies ShotResultPayload);
      notifyLocalTurn();
      return;
    }

    const shieldedShip = localShieldRef.current > 0 ? findShipAt(current.localBoard, coord) : undefined;
    if (shieldedShip) {
      const nextLocalShield = Math.max(0, localShieldRef.current - 1);
      setLocalShield(nextLocalShield);
      showEventToast("Your shield blocked a hit.");
      const board = markShieldedShot(current.localBoard, coord);
      playAttackVisual("local", coord, "shielded", OPPONENT_SOUND_VOLUME);
      playShotResultSound("shielded", OPPONENT_SOUND_VOLUME);
      const nextState: GameState = {
        ...current,
        localBoard: board,
        turn: "local",
        moves: current.moves + 1,
        log: [`remote SHIELDED at ${coord.row + 1},${coord.col + 1}`, ...current.log].slice(0, 30)
      };
      showBattleBoard("target", 0, BOARD_SWITCH_DELAY_MS);
      setGameAfterImpact(nextState, current.turn);
      network.current?.send("shot-result", {
        coord,
        result: "shielded",
        board,
        nextTurn: "local",
        winner: null,
        defenderShield: nextLocalShield
      } satisfies ShotResultPayload);
      notifyLocalTurn();
      return;
    }

    const shot = receiveShot(current.localBoard, coord);
    if (shot.result === "duplicate") {
      network.current?.send("shot-result", {
        coord,
        result: "duplicate",
        board: current.localBoard,
        nextTurn: "remote",
        winner: null,
        defenderShield: localShieldRef.current
      } satisfies ShotResultPayload);
      return;
    }
    playAttackVisual("local", coord, shot.result, OPPONENT_SOUND_VOLUME);
    playShotResultSound(shot.result, OPPONENT_SOUND_VOLUME);
    const winner: PlayerSide | null = allShipsSunk(shot.board) ? "remote" : null;
    const nextTurn: PlayerSide = shot.result === "miss" ? "local" : "remote";
    showBattleBoard(nextTurn === "local" && !winner ? "target" : "fleet", 0, nextTurn === "local" && !winner ? BOARD_SWITCH_DELAY_MS : 0);
    const nextState: GameState = {
      ...current,
      localBoard: shot.board,
      turn: winner ? "remote" : nextTurn,
      winner,
      phase: winner ? "defeat" : current.phase,
      moves: current.moves + 1,
      endedAt: winner ? performance.now() : current.endedAt,
      log: [`remote ${shot.result.toUpperCase()} at ${coord.row + 1},${coord.col + 1}`, ...current.log].slice(0, 30)
    };
    setGameAfterImpact(nextState, current.turn);
    network.current?.send("shot-result", {
      coord,
      result: shot.result,
      board: shot.board,
      shipId: shot.shipId,
      nextTurn,
      winner,
      defenderShield: localShieldRef.current
    } satisfies ShotResultPayload);
    if (winner) {
      endMatch("loss", nextState);
    } else if (nextTurn === "local") {
      notifyLocalTurn();
    }
  }

  function rematch() {
    setLocalReady(false);
    setRemoteReady(false);
    setRemoteBoardReady(null);
    setGame((current) => resetBoards(current, current.settings));
    if (matchMode === "p2p" && peerRole === "host") {
      network.current?.send("settings", gameRef.current.settings);
    }
  }

  function applyRemoteShotResult(payload: ShotResultPayload) {
    if (payload.attackerShield !== undefined) {
      setLocalShield(payload.attackerShield);
    }
    if (payload.defenderShield !== undefined) {
      setRemoteShield(payload.defenderShield);
    }
    if (payload.chaosMessage) {
      showEventToast(payload.chaosMessage);
    }
    if (payload.treasureKind === "shield") {
      showEventToast("Treasure found: one-hit shield armed.");
    } else if (payload.treasureKind === "fake") {
      showEventToast("Fake treasure! You got faked out.");
    } else if (payload.result === "shielded") {
      showEventToast("Shield blocked the hit.");
    }
    setGame((current) => {
      const shot =
        payload.board ? { board: payload.board, result: payload.result } :
        payload.treasureKind ? { board: markTreasureShot(current.remoteBoard, payload.coord), result: "miss" as ShotResult } :
        payload.result === "shielded" ? { board: markShieldedShot(current.remoteBoard, payload.coord), result: "shielded" as ShotResult } :
        receiveShot(current.remoteBoard, payload.coord);
      const nextWinner: PlayerSide | null = payload.winner === "local" ? "remote" : payload.winner === "remote" ? "local" : null;
      const nextTurn: PlayerSide = payload.nextTurn === "local" ? "remote" : "local";
      const phase = nextWinner === "local" ? "victory" : nextWinner === "remote" ? "defeat" : current.phase;
      const nextState: GameState = {
        ...current,
        remoteBoard: shot.result === "duplicate" ? current.remoteBoard : shot.board,
        turn: nextWinner ? current.turn : nextTurn,
        winner: nextWinner,
        phase,
        endedAt: nextWinner ? performance.now() : current.endedAt
      };
      if (nextWinner === "local") {
        endMatch("win", nextState);
      } else if (nextTurn === "local") {
        notifyLocalTurn();
      }
      showBattleBoard(nextTurn === "local" && !nextWinner ? "target" : "fleet", nextTurn === "remote" && !nextWinner ? BOARD_RETURN_DELAY_MS : 0);
      if (!nextWinner && nextState.turn !== current.turn) {
        window.setTimeout(() => {
          setGame((latest) => (latest.phase === "battle" && latest.moves === nextState.moves ? { ...latest, turn: nextState.turn } : latest));
        }, BOARD_SWITCH_DELAY_MS);
        return { ...nextState, turn: current.turn };
      }
      return nextState;
    });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button
          className="brand brand-button"
          type="button"
          title="Go to main page"
          onClick={() => {
            setActiveTab("play");
          }}
        >
          <Anchor />
          <div>
            <strong>
              <span className="brand-title">Sea Battle Extended</span>
              <span className="version-badge">{appVersion?.commit ? `v${appVersion.commit.slice(0, 7)}` : "local"}</span>
            </strong>
            <small>WebRTC fleet battles</small>
          </div>
        </button>
        <div className="top-actions">
          <div className="presence-chip" aria-label="Live site activity">
            <span>{presenceStatus.onlinePlayers} online</span>
            <small>{presenceStatus.activeGames} active games</small>
          </div>
          <button
            className="player-chip"
            type="button"
            title="Open profile"
            onClick={() => {
              setActiveTab("profile");
            }}
          >
            <UserRound size={18} />
            {profile.displayName}
          </button>
        </div>
      </header>

      <nav className={matchActive && activeTab === "play" ? "tabbar tabbar-hidden" : "tabbar"}>
        {[
          ["play", Shield, "Play"],
          ["lobby", Radio, "Lobby"],
          ["profile", Settings, "Profile"],
          ["stats", Trophy, "Stats"],
          ["achievements", Crown, "Awards"]
        ].map(([key, Icon, label]) => (
          <button
            className={activeTab === key ? "active" : ""}
            type="button"
            key={key as string}
            onClick={() => setActiveTab(key as typeof activeTab)}
          >
            <Icon size={19} />
            <span>{label as string}</span>
          </button>
        ))}
      </nav>

      {activeTab === "play" && (
        <div className={matchActive ? "content-grid battle-grid" : "content-grid setup-focus"}>
          {game.phase !== "battle" && game.phase !== "victory" && game.phase !== "defeat" && (
            <SetupPanel
              settings={game.settings}
              orientation={orientation}
              onSettings={updateSettings}
              onRotate={() => setOrientation((value) => (value === "horizontal" ? "vertical" : "horizontal"))}
              onShuffle={shuffle}
              onStart={beginLocalBattle}
              ready={matchMode === "practice" && placementReady}
            />
          )}
          {game.phase === "menu" && (
            <section className="panel hero-panel">
              <h1>Ready your fleet.</h1>
              <p>Choose a board, tweak the randomized fleet if you want, then start a practice battle or create a P2P room.</p>
              <button className="primary" type="button" onClick={() => updateSettings(game.settings)}>Ready fleet</button>
            </section>
          )}
          {game.phase === "placing" && (
            <>
              <BoardGrid
                board={game.localBoard}
                revealShips
                interactive={!localReady}
                preview={preview}
                selectedShip={selectedShip}
                orientation={orientation}
                onCellPress={placeSelectedShip}
                onCellHover={setHovered}
                label="Your waters"
                collapsible
                expanded={placementBoardExpanded}
                onToggleExpand={() => setPlacementBoardExpanded((value) => !value)}
              />
              {matchMode === "p2p" && (
                <section className="panel p2p-ready-panel">
                  <div className="section-title">
                    <span>Multiplayer fleet</span>
                    <small className="console-status">{networkStatus}</small>
                  </div>
                  {roomCode && (
                    <div className="setup-room-code">
                      <div>
                        <small>{peerRole === "host" ? "Share code" : "Room code"}</small>
                        <strong>{roomCode}</strong>
                      </div>
                      {peerRole === "host" && (
                        <button className="secondary compact-action" type="button" onClick={() => void copyToClipboard(roomCode)}>
                          Copy
                        </button>
                      )}
                    </div>
                  )}
                  {peerRole === "host" && shareLink && (
                    <div className="share-link-card">
                      <div>
                        <small>Join link</small>
                        <strong>{shareLink}</strong>
                      </div>
                      <button className="secondary compact-action" type="button" onClick={() => void copyToClipboard(shareLink)}>
                        Copy
                      </button>
                    </div>
                  )}
                  <div className="ready-grid">
                    <div className={localReady ? "ready-pill ready" : "ready-pill"}>
                      <small>Your fleet</small>
                      <strong>{localReady ? "Ready" : `${game.localBoard.ships.length}/${config.fleet.length}`}</strong>
                    </div>
                    <div className={remoteReady ? "ready-pill ready" : "ready-pill"}>
                      <small>{opponent.displayName}</small>
                      <strong>{remoteReady ? "Ready" : waitingLabel}</strong>
                    </div>
                  </div>
                  <button className="primary" type="button" disabled={!placementReady || localReady} onClick={markReady}>
                    Ready
                  </button>
                  {peerRole === "host" && (
                    <button className="secondary" type="button" disabled={!localReady || !remoteReady} onClick={startP2PBattle}>
                      Start P2P Battle
                    </button>
                  )}
                  <button className="secondary" type="button" onClick={leaveOrForfeit}>
                    Leave game
                  </button>
                </section>
              )}
            </>
          )}
          {(game.phase === "battle" || game.phase === "victory" || game.phase === "defeat") && (
            <>
              <section className="battle-status">
                <div className="battle-player battle-player-local">
                  <small>{peerRole === "guest" ? "Guest" : "Host"}</small>
                  <strong>{profile.displayName}</strong>
                </div>
                <div className="battle-turn">
                  <small>Turn</small>
                  <strong>{game.turn === "local" ? "You" : opponent.displayName}</strong>
                </div>
                <div className="battle-player battle-player-remote">
                  <small>{peerRole === "guest" ? "Host" : "Enemy"}</small>
                  <strong>{opponent.displayName}</strong>
                </div>
                {game.settings.blitz.enabled && <div className="timer">{Math.ceil(clock)}</div>}
                <button className="icon-button stats-match-button" type="button" onClick={() => setShowOpponentStats((value) => !value)} title="Opponent stats">
                  <BarChart3 size={18} />
                  Stats
                </button>
                {matchMode === "p2p" && game.phase === "battle" && (
                  <button className="icon-button stats-match-button danger-action" type="button" onClick={leaveOrForfeit} title="Forfeit match">
                    Forfeit
                  </button>
                )}
                <div className="audio-toggle" aria-label="Audio settings">
                  {([
                    ["on", Volume2, "All"],
                    ["music-muted", Music2, "SFX"],
                    ["muted", VolumeX, "Mute"]
                  ] as const).map(([mode, Icon, label]) => (
                    <button
                      className={audioMode === mode ? "active" : ""}
                      type="button"
                      key={mode}
                      title={mode === "on" ? "Music and effects on" : mode === "music-muted" ? "Mute music only" : "Mute music and effects"}
                      onClick={() => setAudioMode(mode)}
                    >
                      <Icon size={16} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </section>
              {showOpponentStats && (
                <section className="panel match-stats">
                  <div className="section-title">
                    <span>Against {opponent.displayName}</span>
                    <small>{opponent.playerId}</small>
                  </div>
                  <div className="stats-grid compact-stats">
                    <div className="stat"><small>Games</small><strong>{opponentRecord?.games ?? 0}</strong></div>
                    <div className="stat"><small>Wins</small><strong>{opponentRecord?.wins ?? 0}</strong></div>
                    <div className="stat"><small>Losses</small><strong>{opponentRecord?.losses ?? 0}</strong></div>
                    <div className="stat"><small>Win rate</small><strong>{opponentRecord?.games ? Math.round((opponentRecord.wins / opponentRecord.games) * 100) : 0}%</strong></div>
                  </div>
                </section>
              )}
              <section className="battle-command-panel">
                <div className="battle-board-tabs">
                  <button className={battleBoardView === "target" ? "active" : ""} type="button" onClick={() => setBattleBoardView("target")}>
                    Target
                  </button>
                  <button className={battleBoardView === "fleet" ? "active" : ""} type="button" onClick={() => setBattleBoardView("fleet")}>
                    Your board
                  </button>
                </div>
                <div
                  className={`battle-leaderboard ${leadingSide === "local" ? "lead-local" : leadingSide === "remote" ? "lead-remote" : "lead-tied"}`}
                  style={{ "--lead-scale": crownScale } as React.CSSProperties}
                >
                  <div className="fleet-count fleet-count-local">
                    <strong>{profile.displayName}</strong>
                    <small>{localShipsLeft}</small>
                  </div>
                  <div className="lead-crown">
                    <Crown size={34} />
                    <strong>{battleLeadLabel}</strong>
                  </div>
                  <div className="fleet-count fleet-count-remote">
                    <strong>{opponent.displayName}</strong>
                    <small>{enemyShipsLeft}</small>
                  </div>
                </div>
              </section>
              <div className="board-stage-wrap">
                <div className={`battle-board-stage showing-${battleBoardView}${game.phase === "battle" && game.turn === "local" ? " your-turn" : ""}`}>
                  <div className="battle-board-slide battle-board-target" aria-hidden={battleBoardView !== "target"}>
                    <BoardGrid
                      board={game.remoteBoard}
                      revealShips={game.phase !== "battle"}
                      interactive={game.phase === "battle" && game.turn === "local" && battleBoardView === "target"}
                      selectedCoord={selectedTarget}
                      onCellPress={selectTarget}
                      attackAnimation={attackVisual?.board === "remote" ? attackVisual : null}
                      fogActive={game.phase === "battle" && game.settings.modifiers.fogTide}
                      chaosActive={game.phase === "battle" && game.settings.modifiers.pirateChaos}
                      stormPhase={stormPhase}
                      label="Target board"
                    />
                  </div>
                  <div className="battle-board-slide battle-board-fleet" aria-hidden={battleBoardView !== "fleet"}>
                    <BoardGrid
                      board={game.localBoard}
                      revealShips
                      attackAnimation={attackVisual?.board === "local" ? attackVisual : null}
                      chaosActive={game.phase === "battle" && game.settings.modifiers.pirateChaos}
                      stormPhase={stormPhase}
                      label="Your board"
                    />
                  </div>
                </div>
                <section className="fire-controls fire-controls-bottom">
                  <button className="primary fire-button" type="button" disabled={game.phase !== "battle" || game.turn !== "local" || battleBoardView !== "target" || !selectedTarget} onClick={fireSelectedTarget}>
                    Fire!
                  </button>
                </section>
                {(game.phase === "victory" || game.phase === "defeat") && (
                  <section className={game.phase === "victory" ? "result victory" : "result defeat"}>
                    <h2>{game.phase === "victory" ? "Victory" : "Defeat"}</h2>
                    {matchMode !== "p2p" || peerRole === "host" ? (
                      <button className="primary" type="button" onClick={rematch}>Rematch</button>
                    ) : (
                      <p>Waiting for host to start a rematch…</p>
                    )}
                  </section>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === "lobby" && (
        <div className="content-grid lobby-grid">
          <section className="panel lobby-actions-panel">
            <div className="section-title">
              <span>P2P Lobby</span>
              <small className="console-status">{networkStatus}</small>
            </div>
            <button className="primary" type="button" onClick={() => void createRoom()}>Create Game</button>
            {roomCode && <div className="room-code">{roomCode}</div>}
            {shareLink && (
              <div className="share-link-card">
                <div>
                  <small>Share link</small>
                  <strong>{shareLink}</strong>
                </div>
                <button className="secondary compact-action" type="button" onClick={() => void copyToClipboard(shareLink)}>
                  Copy
                </button>
              </div>
            )}
            <label className="field">
              Join code
              <input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="ABC123" />
            </label>
            <button className="secondary" type="button" onClick={() => void joinRoom()}>Join Game</button>
            <div className="open-lobbies">
              <div className="section-title">
                <span>Open lobbies</span>
                <button className="secondary compact-action" type="button" onClick={() => void refreshOpenLobbies()}>
                  Refresh
                </button>
              </div>
              {openLobbies.length ? (
                openLobbies.map((lobby) => (
                  <button
                    className="lobby-row"
                    type="button"
                    key={lobby.roomCode}
                    onClick={() => void joinRoom(lobby.roomCode)}
                  >
                    <strong>{lobby.roomCode}</strong>
                    <small>{Math.max(0, Math.round((Date.now() - lobby.updatedAt) / 60000))}m ago</small>
                  </button>
                ))
              ) : (
                <small>No open lobbies found.</small>
              )}
            </div>
          </section>
          <section className="panel lobby-opponent-panel">
            <div className="section-title">
              <span>Opponent</span>
              <small>{lobbyOpponent.playerId}</small>
            </div>
            <div className="opponent-card">
              <strong>{lobbyOpponent.playerId === waitingIdentity.playerId ? `${waitingLabel} for opponent` : lobbyOpponent.displayName}</strong>
              <span>{lobbyOpponent.playerId === waitingIdentity.playerId ? networkStatus : `${lobbyOpponent.statsSummary.games} games · ${lobbyOpponent.statsSummary.winRate}% win rate`}</span>
            </div>
          </section>
        </div>
      )}

      {activeTab === "profile" && (
        <ProfilePanel
          profile={profile}
          stats={stats}
          onProfileChange={setProfile}
          onImported={(nextProfile, nextStats) => {
            setProfile(nextProfile);
            setStats(nextStats);
          }}
        />
      )}
      {activeTab === "stats" && (
        <StatsPanel
          stats={stats}
          onRemoveMatch={(matchId) => setStats((current) => removeMatch(current, matchId))}
          onResetStats={() => setStats(makeEmptyStats())}
          onPrestige={() =>
            setStats((current) => {
              const next = prestigeStats(current);
              if (next.prestige > current.prestige && !current.achievements.prestige_1) {
                const achievement = getAchievement("prestige_1");
                if (achievement) {
                  showAchievementToast(achievement);
                }
              }
              return next;
            })
          }
        />
      )}
      {activeTab === "achievements" && <AchievementsPanel stats={stats} />}
      {copyNotice && <div className="copy-toast" role="status">{copyNotice}</div>}
      {eventToast && <div className="event-toast" role="status">{eventToast}</div>}
      {achievementToast && (
        <div className="achievement-toast" role="status">
          <Trophy size={20} />
          <div>
            <small>Achievement unlocked</small>
            <strong>{achievementToast.title}</strong>
          </div>
        </div>
      )}
    </main>
  );
}

export { App };
