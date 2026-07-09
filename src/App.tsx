import { Anchor, BarChart3, ChevronDown, Crown, Music2, Radio, RotateCw, Settings, Shield, Shuffle, Trophy, UserRound, Volume2, VolumeX } from "lucide-react";
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
import {
  adminCloseLobby,
  fetchAdminStatus,
  fetchPresenceStatus,
  isHiddenLeaderboardName,
  leavePresence,
  loadAdminToken,
  PeerGameClient,
  pingPresence,
  saveAdminToken,
  submitGlobalLeaderboard,
  type LobbySummary,
  type PresenceStatus
} from "./services/network";
import {
  loadProfile,
  loadStats,
  getAchievement,
  getRankProgress,
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
import type { BoardState, Coordinate, GameSettings, GameState, Orientation, PeerIdentity, PlayerSide, ShotResult, TreasureKind } from "./types/game";

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

function nukeBoard(board: BoardState): BoardState {
  return {
    ...board,
    ships: board.ships.map((ship) => ({
      ...ship,
      hits: getShipCells(ship)
    })),
    shots: board.ships.reduce<Record<string, ShotResult>>((shots, ship) => {
      for (const cell of getShipCells(ship)) {
        shots[coordKey(cell)] = "sunk";
      }
      return shots;
    }, { ...board.shots })
  };
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
const STORM_MOVE_INTERVAL = 18;

interface ReadyPayload {
  board: BoardState;
}

interface ShotPayload {
  coord: Coordinate;
  treasureCoord?: Coordinate;
}

interface MultiShotPayload {
  coords: Coordinate[];
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
  treasureKind?: TreasureKind;
  chaosMessage?: string;
}

interface MultiShotResultPayload {
  results: ShotResultPayload[];
  board: BoardState;
  nextTurn: "local" | "remote";
  winner: "local" | "remote" | null;
}

interface StormBoardPayload {
  board: BoardState;
}

interface XpBreakdown {
  result: "win" | "loss";
  rows: Array<{ label: string; amount: number }>;
  total: number;
}

interface SocialMessage {
  id: string;
  from: "local" | "remote";
  text: string;
  kind: "chat" | "reaction";
}

interface WindState {
  label: string;
  angle: number;
  speed: number;
}

const reactions = [
  { id: "laugh", label: "Laugh", emoji: "😂" },
  { id: "confused", label: "Confused", emoji: "❓" },
  { id: "thinking", label: "Thinking", emoji: "🤔" },
  { id: "angry", label: "Angry", emoji: "😡" }
] as const;

const windOptions: WindState[] = [
  { label: "N", angle: 180, speed: 2 },
  { label: "NE", angle: 225, speed: 3 },
  { label: "E", angle: 270, speed: 4 },
  { label: "SE", angle: 315, speed: 2 },
  { label: "S", angle: 0, speed: 5 },
  { label: "SW", angle: 45, speed: 3 },
  { label: "W", angle: 90, speed: 4 },
  { label: "NW", angle: 135, speed: 2 }
];

function randomWind(): WindState {
  const base = windOptions[Math.floor(Math.random() * windOptions.length)];
  return { ...base, speed: Math.max(1, Math.min(5, base.speed + Math.floor(Math.random() * 3) - 1)) };
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
  const [socialMessages, setSocialMessages] = useState<SocialMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [attackVisual, setAttackVisual] = useState<(AttackAnimation & { board: "local" | "remote" }) | null>(null);
  const [matchMode, setMatchMode] = useState<MatchMode>("practice");
  const [peerRole, setPeerRole] = useState<PeerRole>(null);
  const [localReady, setLocalReady] = useState(false);
  const [remoteReady, setRemoteReady] = useState(false);
  const [remoteBoardReady, setRemoteBoardReady] = useState<BoardState | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<Coordinate | null>(null);
  const [selectedTargets, setSelectedTargets] = useState<Coordinate[]>([]);
  const [battleBoardView, setBattleBoardView] = useState<BattleBoardView>("target");
  const [appVersion, setAppVersion] = useState<AppVersion | null>(null);
  const [copyNotice, setCopyNotice] = useState("");
  const [eventToast, setEventToast] = useState("");
  const [achievementToast, setAchievementToast] = useState<AchievementDefinition | null>(null);
  const [xpBreakdown, setXpBreakdown] = useState<XpBreakdown | null>(null);
  const [stormPhase, setStormPhase] = useState<StormPhase>("clear");
  const [localShield, setLocalShield] = useState(0);
  const [remoteShield, setRemoteShield] = useState(0);
  const [localMultiBombShots, setLocalMultiBombShots] = useState(0);
  const [wind, setWind] = useState<WindState>(() => randomWind());
  const [placementBoardExpanded, setPlacementBoardExpanded] = useState(false);
  const [setupPanelExpanded, setSetupPanelExpanded] = useState(true);
  const [openLobbies, setOpenLobbies] = useState<LobbySummary[]>([]);
  const [presenceStatus, setPresenceStatus] = useState<PresenceStatus>({ onlinePlayers: 1, activeGames: 0, lobbies: [] });
  const [audioMode, setAudioMode] = useState<AudioMode>(() => (localStorage.getItem(audioModeKey) as AudioMode | null) ?? "on");
  const [adminToken, setAdminToken] = useState(() => loadAdminToken().token);
  const [adminVerified, setAdminVerified] = useState(false);
  const [adminCloseCode, setAdminCloseCode] = useState("");
  const [revealHiddenAchievements, setRevealHiddenAchievements] = useState(false);
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
  const pendingStormPreview = useRef(false);
  const matchRecordedRef = useRef(false);
  const suppressMatchStatsRef = useRef(false);

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
    if (matchMode !== "p2p" || peerRole !== "host" || game.phase !== "battle") {
      return;
    }
    network.current?.send("resync", { turn: game.turn, moves: game.moves });
  }, [game.moves, game.phase, game.turn, matchMode, peerRole]);

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

  useEffect(() => {
    if (matchMode === "p2p" && peerRole === "guest" && game.phase === "placing") {
      setSetupPanelExpanded(false);
    }
  }, [game.phase, matchMode, peerRole]);

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

  function appendSocialMessage(message: SocialMessage): void {
    setSocialMessages((current) => [...current, message].slice(-6));
  }

  function sendReaction(reaction: (typeof reactions)[number]): void {
    if (matchMode !== "p2p" || !roomCode) {
      return;
    }
    audio.play(`react-${reaction.id}`, 0.7);
    const message: SocialMessage = { id: crypto.randomUUID(), from: "local", text: reaction.label, kind: "reaction" };
    appendSocialMessage(message);
    network.current?.send("reaction", { text: reaction.label, reaction: reaction.id });
  }

  function sendChat(): void {
    const text = chatInput.trim().slice(0, 120);
    if (matchMode !== "p2p" || !roomCode || !text) {
      return;
    }
    const message: SocialMessage = { id: crypto.randomUUID(), from: "local", text, kind: "chat" };
    appendSocialMessage(message);
    setChatInput("");
    network.current?.send("chat", { text });
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

  function makeXpBreakdown(result: "win" | "loss", state: GameState): XpBreakdown {
    const shotValues = Object.values(state.remoteBoard.shots);
    const shots = shotValues.filter((value) => value !== "duplicate" && value !== "invalid").length;
    const hits = shotValues.filter((value) => value === "hit" || value === "sunk").length;
    const sunk = state.remoteBoard.ships.filter(isShipSunk).length;
    const rows = [
      { label: result === "win" ? "Victory bonus" : "Match played", amount: result === "win" ? xpAwards.win : xpAwards.loss },
      { label: "Shots fired", amount: shots * xpAwards.shot },
      { label: "Successful hits", amount: hits * xpAwards.hit },
      { label: "Ships sunk", amount: sunk * xpAwards.sunk }
    ].filter((row) => row.amount > 0);
    return {
      result,
      rows,
      total: rows.reduce((sum, row) => sum + row.amount, 0)
    };
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
      const publicStatus = await pingPresence(sessionId);
      const status = adminVerified && adminToken.trim()
        ? await fetchAdminStatus(adminToken.trim()).catch(() => publicStatus)
        : publicStatus;
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
  }, [adminToken, adminVerified]);

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
    const rank = getRankProgress(stats.xp);
    const timeout = window.setTimeout(() => {
      if (suppressMatchStatsRef.current || isHiddenLeaderboardName(profile.displayName)) {
        return;
      }
      void submitGlobalLeaderboard({
        playerId: profile.playerId,
        displayName: profile.displayName,
        lifetimeXp: stats.lifetimeXp,
        xp: stats.xp,
        prestige: stats.prestige,
        rank: rank.rank,
        wins: stats.wins,
        losses: stats.losses,
        games: stats.totalGames,
        shipsDestroyed: stats.shipsDestroyed
      }).catch(() => undefined);
    }, 1200);
    return () => window.clearTimeout(timeout);
  }, [profile.displayName, profile.playerId, stats.lifetimeXp, stats.losses, stats.prestige, stats.shipsDestroyed, stats.totalGames, stats.wins, stats.xp]);

  useEffect(() => {
    localStorage.setItem(audioModeKey, audioMode);
    audio.setEffectsEnabled(audioMode !== "muted");
    audio.setMusicEnabled(audioMode === "on");
  }, [audioMode]);

  useEffect(() => {
    if (!adminToken.trim()) {
      setAdminVerified(false);
      return;
    }
    let active = true;
    void fetchAdminStatus(adminToken.trim())
      .then(() => {
        if (active) {
          setAdminVerified(true);
        }
      })
      .catch(() => {
        if (active) {
          setAdminVerified(false);
        }
      });
    return () => {
      active = false;
    };
  }, [adminToken]);

  useEffect(() => {
    const resumeAudio = () => {
      if (document.visibilityState === "visible") {
        void audio.resume();
        if (gameRef.current.phase === "battle" && audioMode === "on") {
          void audio.playTheme();
        }
      }
    };
    window.addEventListener("focus", resumeAudio);
    window.addEventListener("pageshow", resumeAudio);
    window.addEventListener("pointerdown", resumeAudio);
    document.addEventListener("visibilitychange", resumeAudio);
    return () => {
      window.removeEventListener("focus", resumeAudio);
      window.removeEventListener("pageshow", resumeAudio);
      window.removeEventListener("pointerdown", resumeAudio);
      document.removeEventListener("visibilitychange", resumeAudio);
    };
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
    if (game.phase !== "battle" || !game.settings.modifiers.stormMode || game.moves === 0 || game.moves % STORM_MOVE_INTERVAL !== 0 || lastStormMove.current === game.moves) {
      return;
    }
    if (stormTimer.current !== null) {
      return;
    }
    lastStormMove.current = game.moves;
    setStormPhase("warning");
    audio.play("storm-warn", 0.8);
    stormTimer.current = window.setTimeout(() => {
      stormTimer.current = null;
      setStormPhase("wave");
      audio.play("storm-wave", 0.9);
      const current = gameRef.current;
      if (current.phase === "battle") {
        const localStorm = driftBoardWithStorm(current.localBoard);
        const remoteStorm = matchMode === "practice" ? driftBoardWithStorm(current.remoteBoard) : { board: current.remoteBoard, moved: false };
        if (localStorm.moved) {
          unlockLocalAchievement("storm_chaser");
          network.current?.send("storm-board", { board: localStorm.board } satisfies StormBoardPayload);
          if (current.turn === "local") {
            showBattleBoard("fleet", 2200, 0);
          } else {
            pendingStormPreview.current = true;
          }
        }
        setGame({
          ...current,
          localBoard: localStorm.board,
          remoteBoard: remoteStorm.board
        });
      }
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
    if (game.phase === "battle" && game.settings.modifiers.stormMode) {
      return;
    }
    if (stormTimer.current !== null) {
      window.clearTimeout(stormTimer.current);
      stormTimer.current = null;
    }
    if (stormClearTimer.current !== null) {
      window.clearTimeout(stormClearTimer.current);
      stormClearTimer.current = null;
    }
    setStormPhase("clear");
  }, [game.phase, game.settings.modifiers.stormMode]);

  useEffect(() => {
    if (game.phase === "battle" && game.moves > 0 && game.moves % 6 === 0) {
      setWind(randomWind());
    }
  }, [game.moves, game.phase]);

  useEffect(() => {
    if (game.phase !== "battle") {
      setSelectedTarget(null);
      setSelectedTargets([]);
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
    if (matchMode === "p2p" && peerRole === "guest") {
      return;
    }
    const nextSettings = normalizeSettings(settings);
    setLocalReady(false);
    setRemoteReady(false);
    setRemoteBoardReady(null);
    setSocialMessages([]);
    setLocalShield(0);
    setRemoteShield(0);
    setLocalMultiBombShots(0);
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
    setLocalMultiBombShots(0);
    setGame((current) => ({ ...current, localBoard: board, selectedShipId: nextUnplacedShipId(current.settings, new Set(board.ships.map((ship) => ship.id))) }));
  }

  function beginLocalBattle() {
    const remoteBoard = createBoardForSettings(game.settings);
    matchRecordedRef.current = false;
    suppressMatchStatsRef.current = false;
    setLocalShield(0);
    setRemoteShield(0);
    setLocalMultiBombShots(0);
    setXpBreakdown(null);
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
    if (localMultiBombShots > 0) {
      setSelectedTargets((current) => {
        const exists = current.some((target) => sameCoord(target, coord));
        if (exists) {
          const next = current.filter((target) => !sameCoord(target, coord));
          setSelectedTarget(next[0] ?? null);
          return next;
        }
        const next = [...current, coord].slice(0, localMultiBombShots);
        setSelectedTarget(next[0] ?? null);
        return next;
      });
      return;
    }
    setSelectedTarget(coord);
    setSelectedTargets([coord]);
  }, [game.phase, game.remoteBoard, game.turn, localMultiBombShots]);

  const fireSelectedTarget = useCallback(() => {
    const targets = localMultiBombShots > 0 ? selectedTargets : selectedTarget ? [selectedTarget] : [];
    if (!targets.length || (localMultiBombShots > 0 && targets.length < localMultiBombShots)) {
      return;
    }
    const legalTargets = targets.filter((target) => !hasBlockingShot(game.remoteBoard, target) && !isSunkBufferCoord(game.remoteBoard, target));
    if (legalTargets.length !== targets.length) {
      setSelectedTarget(null);
      setSelectedTargets([]);
      return;
    }
    if (localMultiBombShots > 0) {
      fireMultiBomb(legalTargets);
      return;
    }
    fire(legalTargets[0]);
  }, [game.remoteBoard, localMultiBombShots, selectedTarget, selectedTargets]);

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

    if (Math.random() < 0.06) {
      return {
        coord: options[Math.floor(Math.random() * options.length)],
        message: "Curveball!"
      };
    }

    return { coord };
  }

  function treasureLabel(kind: TreasureKind): string {
    if (kind === "multi-bomb") {
      return "Multi-bomb";
    }
    if (kind === "heat-missile") {
      return "Heat-seeking missile";
    }
    return kind === "shield" ? "TREASURE" : "FAKE TREASURE";
  }

  function findHeatSeekingTarget(board: BoardState): Coordinate | null {
    const candidates = board.ships
      .filter((ship) => !isShipSunk(ship))
      .map((ship) => {
        const hitKeys = new Set(ship.hits.map(coordKey));
        return {
          ship,
          cells: getShipCells(ship).filter((cell) => !hitKeys.has(coordKey(cell)))
        };
      })
      .filter((candidate) => candidate.cells.length > 0);

    if (!candidates.length) {
      return null;
    }

    const maxLength = Math.max(...candidates.map(({ ship }) => ship.length));
    const hitChance = maxLength >= 5 ? 0.95 : maxLength === 4 ? 0.88 : maxLength === 3 ? 0.75 : maxLength === 2 ? 0.58 : 0.35;
    if (Math.random() > hitChance) {
      return null;
    }

    const weighted = candidates.map((candidate) => ({
      ...candidate,
      weight: candidate.ship.length * candidate.ship.length
    }));
    const totalWeight = weighted.reduce((sum, candidate) => sum + candidate.weight, 0);
    let pick = Math.random() * totalWeight;
    for (const candidate of weighted) {
      pick -= candidate.weight;
      if (pick <= 0) {
        return candidate.cells[Math.floor(Math.random() * candidate.cells.length)];
      }
    }
    const fallback = weighted[weighted.length - 1];
    return fallback.cells[Math.floor(Math.random() * fallback.cells.length)];
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
      const hasTarget = localMultiBombShots > 0 ? selectedTargets.length === localMultiBombShots : Boolean(selectedTarget);
      if (gameRef.current.phase !== "battle" || gameRef.current.turn !== "local" || battleBoardView !== "target" || !hasTarget) {
        return;
      }
      event.preventDefault();
      fireSelectedTarget();
    }

    window.addEventListener("keydown", handleFireShortcut);
    return () => window.removeEventListener("keydown", handleFireShortcut);
  }, [battleBoardView, fireSelectedTarget, localMultiBombShots, selectedTarget, selectedTargets.length]);

  function fireMultiBomb(coords: Coordinate[]) {
    if (game.turn !== "local" || coords.length !== localMultiBombShots) {
      return;
    }

    let board = game.remoteBoard;
    let shield = remoteShield;
    const results: ShotResultPayload[] = [];
    let anyHit = false;
    let totalHits = 0;
    let totalSinks = 0;

    for (const coord of coords) {
      const treasure = findTreasureAt(board, coord);
      if (treasure) {
        board = markTreasureShot(board, coord);
        results.push({ coord, result: "miss", board, nextTurn: "remote", winner: null, treasureKind: treasure });
        playAttackVisual("remote", coord, "miss");
        continue;
      }

      const protectedShip = shield > 0 ? findShipAt(board, coord) : undefined;
      if (protectedShip) {
        shield = Math.max(0, shield - 1);
        board = markShieldedShot(board, coord);
        results.push({ coord, result: "shielded", board, nextTurn: "remote", winner: null, defenderShield: shield });
        playAttackVisual("remote", coord, "shielded");
        continue;
      }

      const shot = receiveShot(board, coord);
      board = shot.board;
      if (shot.result === "hit" || shot.result === "sunk") {
        anyHit = true;
        totalHits += 1;
      }
      if (shot.result === "sunk") {
        totalSinks += 1;
      }
      results.push({ coord, result: shot.result, board, shipId: shot.shipId, nextTurn: "remote", winner: null });
      playAttackVisual("remote", coord, shot.result);
      playShotResultSound(shot.result);
    }

    const winner: PlayerSide | null = allShipsSunk(board) ? "local" : null;
    const nextTurn: PlayerSide = winner || anyHit ? "local" : "remote";
    const nextState: GameState = {
      ...game,
      remoteBoard: board,
      turn: winner ? "local" : nextTurn,
      winner,
      phase: winner ? "victory" : game.phase,
      moves: game.moves + 1,
      endedAt: winner ? performance.now() : game.endedAt,
      log: [`local MULTI-BOMB ${coords.length} shots`, ...game.log].slice(0, 30)
    };

    setRemoteShield(shield);
    setLocalMultiBombShots(0);
    setSelectedTarget(null);
    setSelectedTargets([]);
    showEventToast(anyHit ? "Multi-bomb hit!" : "Multi-bomb splashed.");
    showBattleBoard(nextTurn === "local" && !winner ? "target" : "fleet", nextTurn === "remote" ? BOARD_RETURN_DELAY_MS : 0, nextTurn === "remote" ? BOARD_SWITCH_DELAY_MS : 0);
    setGameAfterImpact(nextState, game.turn);
    setStats((current) =>
      awardXp(
        {
          ...current,
          totalShots: current.totalShots + coords.length,
          hits: current.hits + totalHits,
          shipsDestroyed: current.shipsDestroyed + totalSinks
        },
        xpAwards.shot * coords.length + totalHits * xpAwards.hit + totalSinks * xpAwards.sunk
      )
    );
    network.current?.send("multi-shot", { coords } satisfies MultiShotPayload);
    if (winner) {
      endMatch("win", nextState);
      return;
    }
    if (matchMode === "practice" && nextTurn === "remote") {
      window.setTimeout(() => remoteTurn(nextState), 450);
    }
  }

  function fire(coord: Coordinate) {
    if (game.turn !== "local") {
      return;
    }
    const chaos = applyPirateChaos(coord, game.remoteBoard);
    const finalCoord = chaos.coord;
    if (chaos.message && !sameCoord(coord, finalCoord)) {
      unlockLocalAchievement("curveball");
    }
    const treasure = findTreasureAt(game.remoteBoard, finalCoord);
    if (treasure) {
      let remoteBoard = markTreasureShot(game.remoteBoard, finalCoord);
      let result: ShotResult = "miss";
      let missileCoord: Coordinate | null = null;
      const nextLocalShield = treasure === "shield" ? localShield + 1 : localShield;
      if (treasure === "shield") {
        setLocalShield(nextLocalShield);
        unlockLocalAchievement("treasure_found");
        audio.play("turn", 0.65);
        showEventToast(`${chaos.message && !sameCoord(coord, finalCoord) ? `${chaos.message} ` : ""}Treasure found: one-hit shield armed.`);
      } else if (treasure === "multi-bomb") {
        setLocalMultiBombShots(3);
        unlockLocalAchievement("treasure_found");
        audio.play("turn", 0.7);
        showEventToast("Multi-bomb armed. Pick 3 targets.");
      } else if (treasure === "heat-missile") {
        missileCoord = findHeatSeekingTarget(remoteBoard);
        if (missileCoord) {
          const missileShot = receiveShot(remoteBoard, missileCoord);
          remoteBoard = missileShot.board;
          result = missileShot.result;
          playAttackVisual("remote", missileCoord, missileShot.result);
          playShotResultSound(missileShot.result);
          showEventToast(`Heat-seeking missile locked on ${missileShot.result === "miss" ? "but splashed." : "and hit!"}`);
        } else {
          showEventToast("Heat-seeking missile lost the signal.");
        }
        unlockLocalAchievement("treasure_found");
      } else {
        unlockLocalAchievement("fake_treasure");
        showEventToast(`${chaos.message && !sameCoord(coord, finalCoord) ? `${chaos.message} ` : ""}Fake treasure! You got faked out.`);
      }
      const winner: PlayerSide | null = allShipsSunk(remoteBoard) ? "local" : null;
      const nextTurn: PlayerSide = winner || result === "hit" || result === "sunk" ? "local" : "remote";
      const state: GameState = {
        ...game,
        remoteBoard,
        turn: winner ? "local" : nextTurn,
        winner,
        phase: winner ? "victory" : game.phase,
        moves: game.moves + 1,
        endedAt: winner ? performance.now() : game.endedAt,
        log: [`local ${treasureLabel(treasure)} at ${finalCoord.row + 1},${finalCoord.col + 1}`, ...game.log].slice(0, 30)
      };
      setSelectedTarget(null);
      setSelectedTargets([]);
      showBattleBoard(nextTurn === "local" && !winner ? "target" : "fleet", nextTurn === "remote" ? BOARD_RETURN_DELAY_MS : 0, nextTurn === "remote" ? BOARD_SWITCH_DELAY_MS : 0);
      playAttackVisual("remote", finalCoord, "miss");
      playShotResultSound("miss");
      setGameAfterImpact(state, game.turn);
      setStats((current) => awardXp({ ...current, totalShots: current.totalShots + 1 }, xpAwards.shot));
      network.current?.send("shot", { coord: missileCoord ?? finalCoord, treasureCoord: missileCoord ? finalCoord : undefined } satisfies ShotPayload);
      if (winner) {
        endMatch("win", state);
        return;
      }
      if (matchMode === "practice" && nextTurn === "remote") {
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
      setSelectedTargets([]);
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
      unlockLocalAchievement("cursed_curve");
      showEventToast(chaos.message);
    }
    setSelectedTarget(null);
    setSelectedTargets([]);
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
      unlockLocalAchievement("shield_save");
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
    const suppressStats = suppressMatchStatsRef.current;
    setXpBreakdown(suppressStats ? { result, rows: [{ label: "Admin debug match", amount: 0 }], total: 0 } : makeXpBreakdown(result, state));
    audio.play(result === "win" ? "victory" : "defeat");
    if (suppressStats) {
      showEventToast("Admin debug match: stats declined.");
      return;
    }
    if (result === "win") {
      unlockLocalAchievement("first_win");
      if (state.settings.blitz.enabled) {
        unlockLocalAchievement("blitz_win");
      }
      if (state.localBoard.ships.every((ship) => ship.hits.length === 0)) {
        unlockLocalAchievement("flawless_fleet");
      }
      if (getBoardConfig(state.settings.boardId).size >= 16) {
        unlockLocalAchievement("big_board_win");
      }
      if (!Object.values(state.remoteBoard.shots).some((shot) => shot === "miss")) {
        unlockLocalAchievement("perfect_accuracy");
      }
      if (stats.wins + 1 >= 10) {
        unlockLocalAchievement("ten_wins");
      }
    }
    if (state.moves >= 40) {
      unlockLocalAchievement("long_battle");
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
    setSocialMessages([]);
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
    const status = adminVerified && adminToken.trim() ? await fetchAdminStatus(adminToken.trim()) : await fetchPresenceStatus();
    setPresenceStatus(status);
    setOpenLobbies(status.lobbies);
  }

  function updateAdminToken(token: string, remember: boolean): void {
    setAdminToken(token);
    saveAdminToken(token, remember);
    if (!token.trim()) {
      setAdminVerified(false);
    }
  }

  async function closeLobbyAsAdmin(code: string): Promise<void> {
    const normalized = code.trim().toUpperCase();
    if (!adminVerified || !adminToken.trim() || !normalized) {
      return;
    }
    const isCurrentLobby = normalized === roomCode;
    const confirmed = window.confirm(
      isCurrentLobby
        ? `Are you sure you want to close lobby ${normalized}? This will close your current room.`
        : `Are you sure you want to close lobby ${normalized}?`
    );
    if (!confirmed) {
      return;
    }
    await adminCloseLobby(adminToken.trim(), normalized);
    showEventToast(`Room ${normalized} closed`);
    setAdminCloseCode((current) => (current.trim().toUpperCase() === normalized ? "" : current));
    await refreshOpenLobbies();
    if (isCurrentLobby) {
      leaveOrForfeit();
    }
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
    setSetupPanelExpanded(false);
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
        setLocalMultiBombShots(0);
        setSocialMessages([]);
        setActiveTab("play");
        setSetupPanelExpanded(false);
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

      if (message.type === "unready") {
        setRemoteReady(false);
        setRemoteBoardReady(null);
        setNetworkStatus(peerRoleRef.current === "host" ? "Opponent is adjusting their fleet." : "Host is adjusting settings.");
        return;
      }

      if (message.type === "start") {
        matchRecordedRef.current = false;
        suppressMatchStatsRef.current = false;
        setXpBreakdown(null);
        setSocialMessages([]);
        setLocalMultiBombShots(0);
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

      if (message.type === "admin-nuke") {
        const current = gameRef.current;
        if (current.phase === "battle") {
          suppressMatchStatsRef.current = true;
          const nextState: GameState = {
            ...current,
            localBoard: nukeBoard(current.localBoard),
            phase: "defeat",
            winner: "remote",
            endedAt: performance.now(),
            log: ["ADMIN called a Tactical Nuke!", ...current.log].slice(0, 30)
          };
          setGame(nextState);
          showEventToast("ADMIN called a Tactical Nuke! Stats declined.");
          endMatch("loss", nextState);
        }
        return;
      }

      if (message.type === "chat" || message.type === "reaction") {
        const payload = message.payload as { text?: string; reaction?: string };
        const text = String(payload.text ?? "").trim().slice(0, 120);
        if (text) {
          if (message.type === "reaction" && payload.reaction) {
            audio.play(`react-${payload.reaction}`, OPPONENT_SOUND_VOLUME);
          }
          appendSocialMessage({
            id: message.messageId,
            from: "remote",
            text,
            kind: message.type
          });
        }
        return;
      }

      if (message.type === "resync") {
        const payload = message.payload as { turn?: PlayerSide; moves?: number };
        if (peerRoleRef.current === "guest" && payload.turn && typeof payload.moves === "number") {
          setGame((current) => (
            current.phase === "battle" && current.moves === payload.moves
              ? { ...current, turn: payload.turn === "local" ? "remote" : "local" }
              : current
          ));
        }
        return;
      }

      if (message.type === "shot") {
        const payload = message.payload as ShotPayload | Coordinate;
        const coord = "coord" in payload ? payload.coord : payload;
        const treasureCoord = "coord" in payload ? payload.treasureCoord : undefined;
        receiveRemoteShot(coord, treasureCoord);
        return;
      }

      if (message.type === "multi-shot") {
        const payload = message.payload as MultiShotPayload;
        receiveRemoteMultiShot(payload.coords.slice(0, 3));
        return;
      }

      if (message.type === "shot-result") {
        applyRemoteShotResult(message.payload as ShotResultPayload);
      }

      if (message.type === "multi-shot-result") {
        applyRemoteMultiShotResult(message.payload as MultiShotResultPayload);
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

  function unreadyFleet() {
    if (matchMode !== "p2p" || !localReady) {
      return;
    }
    setLocalReady(false);
    setNetworkStatus("Fleet unlocked. Adjust your setup, then Ready again.");
    network.current?.send("unready", {});
  }

  function startP2PBattle() {
    if (peerRole !== "host" || !localReady || !remoteReady || !remoteBoardReady) {
      return;
    }
    matchRecordedRef.current = false;
    suppressMatchStatsRef.current = false;
    setXpBreakdown(null);
    setSocialMessages([]);
    setLocalMultiBombShots(0);
    setGame((current) => startBattle({ ...current, remoteBoard: remoteBoardReady }, remoteBoardReady));
    network.current?.send("start", { startedAt: Date.now() });
    setNetworkStatus("Battle live. Your turn.");
    setActiveTab("play");
  }

  function adminNukeRemoteFleet() {
    if (!adminVerified || matchMode !== "p2p" || game.phase !== "battle") {
      return;
    }
    if (!window.confirm(`Are you sure you want to nuke ${opponent.displayName}'s fleet? This debug match will not count for stats.`)) {
      return;
    }
    suppressMatchStatsRef.current = true;
    const nextState: GameState = {
      ...game,
      remoteBoard: nukeBoard(game.remoteBoard),
      phase: "victory",
      winner: "local",
      endedAt: performance.now(),
      log: ["ADMIN called a Tactical Nuke!", ...game.log].slice(0, 30)
    };
    network.current?.send("admin-nuke", { noStats: true });
    unlockLocalAchievement("admin_nuke");
    setGame(nextState);
    showEventToast("ADMIN called a Tactical Nuke! Stats declined.");
    endMatch("win", nextState);
  }

  function receiveRemoteShot(coord: Coordinate, treasureCoord?: Coordinate) {
    const current = gameRef.current;
    const initialBoard = treasureCoord ? markTreasureShot(current.localBoard, treasureCoord) : current.localBoard;
    if (treasureCoord) {
      showEventToast(`${opponent.displayName} launched a heat-seeking missile.`);
    }
    const treasure = treasureCoord ? undefined : findTreasureAt(initialBoard, coord);
    if (treasure) {
      const board = markTreasureShot(initialBoard, coord);
      const nextRemoteShield = treasure === "shield" ? remoteShieldRef.current + 1 : remoteShieldRef.current;
      if (treasure === "shield") {
        setRemoteShield(nextRemoteShield);
        audio.play("turn", 0.35);
      }
      if (treasure === "multi-bomb") {
        showEventToast(`${opponent.displayName} armed a multi-bomb.`);
      } else if (treasure === "heat-missile") {
        showEventToast(`${opponent.displayName} found a heat-seeking missile.`);
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

    const shieldedShip = localShieldRef.current > 0 ? findShipAt(initialBoard, coord) : undefined;
    if (shieldedShip) {
      const nextLocalShield = Math.max(0, localShieldRef.current - 1);
      setLocalShield(nextLocalShield);
      showEventToast("Your shield blocked a hit.");
      unlockLocalAchievement("shield_save");
      const board = markShieldedShot(initialBoard, coord);
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

    const shot = receiveShot(initialBoard, coord);
    if (shot.result === "duplicate") {
      network.current?.send("shot-result", {
        coord,
        result: "duplicate",
        board: initialBoard,
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
      if (pendingStormPreview.current) {
        pendingStormPreview.current = false;
        showBattleBoard("fleet", 2200, 0);
        window.setTimeout(() => showBattleBoard("target", 0, BOARD_SWITCH_DELAY_MS), 2200);
      }
      notifyLocalTurn();
    }
  }

  function receiveRemoteMultiShot(coords: Coordinate[]) {
    const current = gameRef.current;
    let board = current.localBoard;
    let shield = localShieldRef.current;
    const results: ShotResultPayload[] = [];
    let anyHit = false;

    for (const coord of coords) {
      const treasure = findTreasureAt(board, coord);
      if (treasure) {
        board = markTreasureShot(board, coord);
        results.push({ coord, result: "miss", board, nextTurn: "local", winner: null, treasureKind: treasure });
        playAttackVisual("local", coord, "miss", OPPONENT_SOUND_VOLUME);
        continue;
      }

      const protectedShip = shield > 0 ? findShipAt(board, coord) : undefined;
      if (protectedShip) {
        shield = Math.max(0, shield - 1);
        board = markShieldedShot(board, coord);
        results.push({ coord, result: "shielded", board, nextTurn: "local", winner: null, defenderShield: shield });
        playAttackVisual("local", coord, "shielded", OPPONENT_SOUND_VOLUME);
        continue;
      }

      const shot = receiveShot(board, coord);
      board = shot.board;
      anyHit = anyHit || shot.result === "hit" || shot.result === "sunk";
      results.push({ coord, result: shot.result, board, shipId: shot.shipId, nextTurn: "local", winner: null });
      playAttackVisual("local", coord, shot.result, OPPONENT_SOUND_VOLUME);
      playShotResultSound(shot.result, OPPONENT_SOUND_VOLUME);
    }

    const winner: PlayerSide | null = allShipsSunk(board) ? "remote" : null;
    const nextTurn: PlayerSide = winner || anyHit ? "remote" : "local";
    const nextState: GameState = {
      ...current,
      localBoard: board,
      turn: winner ? "remote" : nextTurn,
      winner,
      phase: winner ? "defeat" : current.phase,
      moves: current.moves + 1,
      endedAt: winner ? performance.now() : current.endedAt,
      log: [`remote MULTI-BOMB ${coords.length} shots`, ...current.log].slice(0, 30)
    };

    setLocalShield(shield);
    showBattleBoard(nextTurn === "local" && !winner ? "target" : "fleet", 0, nextTurn === "local" && !winner ? BOARD_SWITCH_DELAY_MS : 0);
    setGameAfterImpact(nextState, current.turn);
    network.current?.send("multi-shot-result", { results, board, nextTurn, winner } satisfies MultiShotResultPayload);
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
    setXpBreakdown(null);
    suppressMatchStatsRef.current = false;
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
      audio.play("turn", 0.45);
      showEventToast("Treasure found: one-hit shield armed.");
    } else if (payload.treasureKind === "multi-bomb") {
      setLocalMultiBombShots(3);
      audio.play("turn", 0.7);
      showEventToast("Multi-bomb armed. Pick 3 targets.");
    } else if (payload.treasureKind === "heat-missile") {
      showEventToast("Heat-seeking missile launched.");
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

  function applyRemoteMultiShotResult(payload: MultiShotResultPayload) {
    if (payload.results.some((result) => result.result === "hit" || result.result === "sunk")) {
      showEventToast("Multi-bomb confirmed hits.");
    }
    setGame((current) => {
      const nextWinner: PlayerSide | null = payload.winner === "local" ? "remote" : payload.winner === "remote" ? "local" : null;
      const nextTurn: PlayerSide = payload.nextTurn === "local" ? "remote" : "local";
      const phase = nextWinner === "local" ? "victory" : nextWinner === "remote" ? "defeat" : current.phase;
      const nextState: GameState = {
        ...current,
        remoteBoard: payload.board,
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
              <span className="version-badge">
                <span>{appVersion?.commit ? `v${appVersion.commit.slice(0, 7)}` : "local"}</span>
                <small>beta</small>
              </span>
            </strong>
            <small>WebRTC fleet battles</small>
          </div>
        </button>
        <div className="top-actions">
          <div className="presence-chip" aria-label="Live site activity">
            <span>{presenceStatus.onlinePlayers} online</span>
            <small>{presenceStatus.activeGames} games</small>
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
              onSettings={updateSettings}
              onRotate={() => setOrientation((value) => (value === "horizontal" ? "vertical" : "horizontal"))}
              onShuffle={shuffle}
              onStart={beginLocalBattle}
              ready={matchMode === "practice" && placementReady}
              readOnly={matchMode === "p2p" && peerRole === "guest"}
              expanded={setupPanelExpanded}
              onToggleExpanded={() => setSetupPanelExpanded((value) => !value)}
              showPlacementControls={false}
              showStart={matchMode === "practice"}
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
              {placementBoardExpanded && !localReady && (
                <div className="board-action-row">
                  <button className="icon-button" type="button" onClick={() => setOrientation((value) => (value === "horizontal" ? "vertical" : "horizontal"))} title="Rotate selected ship">
                    <RotateCw size={18} /> Rotate
                  </button>
                  <button className="icon-button" type="button" onClick={shuffle} title="Shuffle ships">
                    <Shuffle size={18} /> Shuffle
                  </button>
                </div>
              )}
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
                  {adminVerified && roomCode && (
                    <button className="secondary danger-action" type="button" onClick={() => void closeLobbyAsAdmin(roomCode)}>
                      Close this lobby
                    </button>
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
                  <button className={localReady ? "secondary" : "primary"} type="button" disabled={!localReady && !placementReady} onClick={localReady ? unreadyFleet : markReady}>
                    {localReady ? "Un-ready" : "Ready"}
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
                {adminVerified && matchMode === "p2p" && game.phase === "battle" && (
                  <button className="icon-button stats-match-button danger-action" type="button" onClick={adminNukeRemoteFleet} title="Admin nuke fleet">
                    Nuke
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
                      selectedCoords={selectedTargets}
                      onCellPress={selectTarget}
                      attackAnimation={attackVisual?.board === "remote" ? attackVisual : null}
                      fogActive={game.phase === "battle" && game.settings.modifiers.fogTide}
                      stormPhase={stormPhase}
                      wind={wind}
                      label="Target board"
                    />
                  </div>
                  <div className="battle-board-slide battle-board-fleet" aria-hidden={battleBoardView !== "fleet"}>
                    <BoardGrid
                      board={game.localBoard}
                      revealShips
                      attackAnimation={attackVisual?.board === "local" ? attackVisual : null}
                      stormPhase={stormPhase}
                      wind={wind}
                      label="Your board"
                    />
                  </div>
                </div>
                <section className="fire-controls fire-controls-bottom">
                  <button
                    className="primary fire-button"
                    type="button"
                    disabled={
                      game.phase !== "battle" ||
                      game.turn !== "local" ||
                      battleBoardView !== "target" ||
                      (localMultiBombShots > 0 ? selectedTargets.length !== localMultiBombShots : !selectedTarget)
                    }
                    onClick={fireSelectedTarget}
                  >
                    {localMultiBombShots > 0 ? `Fire ${selectedTargets.length}/${localMultiBombShots}` : "Fire!"}
                  </button>
                </section>
                {matchMode === "p2p" && roomCode && (
                  <section className="battle-social-panel">
                    <div className="reaction-row" aria-label="Quick reactions">
                      {reactions.map((reaction) => (
                        <button className="reaction-button" type="button" key={reaction.id} onClick={() => sendReaction(reaction)} title={reaction.label} aria-label={reaction.label}>
                          <span aria-hidden="true">{reaction.emoji}</span>
                        </button>
                      ))}
                    </div>
                    <div className="chat-stack">
                      <div className="chat-log" aria-live="polite">
                        {socialMessages.length ? (
                          socialMessages.map((message) => (
                            <span className={message.from === "local" ? "local" : "remote"} key={message.id}>
                              <b>{message.from === "local" ? "You" : opponent.displayName}</b> {message.text}
                            </span>
                          ))
                        ) : (
                          <small>No chat yet.</small>
                        )}
                      </div>
                      <form
                        className="chat-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          sendChat();
                        }}
                      >
                        <input value={chatInput} maxLength={120} placeholder="Send a message" onChange={(event) => setChatInput(event.target.value)} />
                        <button className="secondary compact-action" type="submit" disabled={!chatInput.trim()}>
                          Send
                        </button>
                      </form>
                    </div>
                  </section>
                )}
                {(game.phase === "victory" || game.phase === "defeat") && (
                  <section className={game.phase === "victory" ? "result victory" : "result defeat"}>
                    <h2>{game.phase === "victory" ? "Victory" : "Defeat"}</h2>
                    {xpBreakdown && (
                      <div className="xp-breakdown" aria-label="XP gained">
                        <strong>+{xpBreakdown.total} XP</strong>
                        {xpBreakdown.rows.map((row, index) => (
                          <span style={{ "--xp-row": index } as React.CSSProperties} key={row.label}>
                            {row.label} <b>+{row.amount}</b>
                          </span>
                        ))}
                      </div>
                    )}
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
        <div className={roomCode ? "content-grid lobby-grid" : "content-grid lobby-grid lobby-grid-empty"}>
          <section className="panel lobby-actions-panel">
            <div className="section-title">
              <span>P2P Lobby</span>
              {!networkStatus.toLowerCase().includes("offline practice") && <small className="console-status">{networkStatus}</small>}
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
                  <div className="lobby-row" key={lobby.roomCode}>
                    <button
                      className="lobby-join-button"
                      type="button"
                      disabled={lobby.status === "full"}
                      onClick={() => void joinRoom(lobby.roomCode)}
                    >
                      <strong>{lobby.roomCode}</strong>
                      <small>{lobby.status === "full" ? "Full" : "Open"} · {Math.max(0, Math.round((Date.now() - lobby.updatedAt) / 60000))}m ago</small>
                    </button>
                    {adminVerified && (
                      <button
                        className="secondary compact-action danger-action"
                        type="button"
                        onClick={() => void closeLobbyAsAdmin(lobby.roomCode)}
                      >
                        Close
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <small>No open lobbies found.</small>
              )}
            </div>
            {adminVerified && (
              <div className="admin-lobby-close-card">
                <div>
                  <strong>Admin close room</strong>
                  <small>Works for full rooms too if you know the code.</small>
                </div>
                <div className="admin-inline-action">
                  <input
                    value={adminCloseCode}
                    placeholder="ABC123"
                    maxLength={8}
                    onChange={(event) => setAdminCloseCode(event.target.value.toUpperCase())}
                  />
                  <button
                    className="secondary compact-action danger-action"
                    type="button"
                    disabled={!adminCloseCode.trim()}
                    onClick={() => void closeLobbyAsAdmin(adminCloseCode)}
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </section>
          {roomCode && (
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
          )}
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
          adminToken={adminToken}
          adminVerified={adminVerified}
          onAdminTokenChange={updateAdminToken}
          onAdminVerified={setAdminVerified}
        />
      )}
      {activeTab === "stats" && (
        <StatsPanel
          stats={stats}
          showHiddenLeaderboardEntries={adminVerified}
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
      {activeTab === "achievements" && (
        <AchievementsPanel
          stats={stats}
          canRevealHidden={adminVerified}
          revealHidden={revealHiddenAchievements}
          onRevealHiddenChange={setRevealHiddenAchievements}
        />
      )}
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
