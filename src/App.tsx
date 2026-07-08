import { Anchor, BarChart3, ChevronDown, Crown, Music2, Radio, Settings, Shield, Trophy, UserRound, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoardGrid, isSunkBufferCoord } from "./components/BoardGrid";
import type { AttackAnimation } from "./components/BoardGrid";
import { ProfilePanel } from "./components/ProfilePanel";
import { SetupPanel } from "./components/SetupPanel";
import { StatsPanel } from "./components/StatsPanel";
import { allShipsSunk, canPlaceShip, coordKey, findShipAt, getShipCells, isShipSunk, placeShip, randomizeFleet, receiveShot } from "./game/board";
import { boardConfigs, defaultSettings, getBoardConfig } from "./game/config";
import { attack, createInitialGame, resetBoards, startBattle } from "./game/engine";
import { assets } from "./services/assets";
import { audio } from "./services/audio";
import { listOpenLobbies, PeerGameClient, type LobbySummary } from "./services/network";
import {
  loadProfile,
  loadStats,
  makeIdentity,
  makeEmptyStats,
  recordMatch,
  removeMatch,
  saveProfile,
  saveStats,
  type PlayerProfile,
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

type MatchMode = "practice" | "p2p";
type PeerRole = "host" | "guest" | null;
type BattleBoardView = "target" | "fleet";
type AudioMode = "on" | "music-muted" | "muted";
const BOARD_SWITCH_DELAY_MS = 300;
const BOARD_RETURN_DELAY_MS = 1200;
const OPPONENT_SOUND_VOLUME = 0.45;
const audioModeKey = "sea-battle.audio-mode";

interface ReadyPayload {
  board: BoardState;
}

interface ShotPayload {
  coord: Coordinate;
}

interface ShotResultPayload {
  coord: Coordinate;
  result: ShotResult;
  shipId?: string;
  nextTurn: "local" | "remote";
  winner: "local" | "remote" | null;
}

function App() {
  const [profile, setProfile] = useState<PlayerProfile>(() => loadProfile());
  const [stats, setStats] = useState<PlayerStats>(() => loadStats());
  const [game, setGame] = useState(() => createInitialGame(defaultSettings));
  const [orientation, setOrientation] = useState<Orientation>("horizontal");
  const [hovered, setHovered] = useState<Coordinate | null>(null);
  const [activeTab, setActiveTab] = useState<"play" | "profile" | "stats" | "lobby">("play");
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [networkStatus, setNetworkStatus] = useState("Offline practice");
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
  const [fleetPanelExpanded, setFleetPanelExpanded] = useState(false);
  const [placementBoardExpanded, setPlacementBoardExpanded] = useState(false);
  const [openLobbies, setOpenLobbies] = useState<LobbySummary[]>([]);
  const [audioMode, setAudioMode] = useState<AudioMode>(() => (localStorage.getItem(audioModeKey) as AudioMode | null) ?? "on");
  const network = useRef<PeerGameClient | null>(null);
  const gameRef = useRef(game);
  const peerRoleRef = useRef<PeerRole>(null);
  const opponentRef = useRef(opponent);
  const remoteBoardReadyRef = useRef<BoardState | null>(null);
  const boardSwitchTimer = useRef<number | null>(null);
  const boardReturnTimer = useRef<number | null>(null);
  const copyNoticeTimer = useRef<number | null>(null);
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
    if (result === "miss") {
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
    return () => {
      if (copyNoticeTimer.current !== null) {
        window.clearTimeout(copyNoticeTimer.current);
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
    setActiveTab("lobby");
    setNetworkStatus("Shared lobby link ready. Tap Join Game to connect.");
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
    const nextConfig = getBoardConfig(settings.boardId);
    setLocalReady(false);
    setRemoteReady(false);
    setRemoteBoardReady(null);
    setGame((current) => ({
      ...resetBoards(current, settings),
      localBoard: randomizeFleet(nextConfig),
      selectedShipId: null
    }));
    if (matchMode === "p2p" && peerRole === "host") {
      network.current?.send("settings", settings);
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
        setGame((current) => ({
          ...current,
          localBoard: placeShip(current.localBoard, placedShip, placedShip.origin, nextOrientation),
          selectedShipId: placedShip.id
        }));
      } else {
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
    const board = randomizeFleet(config);
    setLocalReady(false);
    setGame((current) => ({ ...current, localBoard: board, selectedShipId: nextUnplacedShipId(current.settings, new Set(board.ships.map((ship) => ship.id))) }));
  }

  function beginLocalBattle() {
    const remoteBoard = randomizeFleet(config);
    matchRecordedRef.current = false;
    setMatchMode("practice");
    setOpponent(guestIdentity);
    setGame((current) => startBattle(current, remoteBoard));
  }

  const selectTarget = useCallback((coord: Coordinate) => {
    if (game.phase !== "battle" || game.turn !== "local") {
      return;
    }
    if (game.remoteBoard.shots[coordKey(coord)] || isSunkBufferCoord(game.remoteBoard, coord)) {
      return;
    }
    setSelectedTarget(coord);
  }, [game.phase, game.remoteBoard, game.turn]);

  const fireSelectedTarget = useCallback(() => {
    if (!selectedTarget) {
      return;
    }
    if (game.remoteBoard.shots[coordKey(selectedTarget)] || isSunkBufferCoord(game.remoteBoard, selectedTarget)) {
      setSelectedTarget(null);
      return;
    }
    fire(selectedTarget);
  }, [game.remoteBoard, selectedTarget]);

  function fire(coord: Coordinate) {
    if (game.turn !== "local") {
      return;
    }
    const { state, outcome } = attack(game, "remote", coord);
    if (outcome.result === "invalid" || outcome.result === "duplicate") {
      return;
    }
    setSelectedTarget(null);
    showBattleBoard(
      outcome.nextTurn === "local" ? "target" : "fleet",
      outcome.nextTurn === "remote" ? BOARD_RETURN_DELAY_MS : 0,
      outcome.nextTurn === "remote" ? BOARD_SWITCH_DELAY_MS : 0
    );
    playAttackVisual("remote", coord, outcome.result);
    playShotResultSound(outcome.result);
    setGameAfterImpact(state, game.turn);
    setStats((current) => ({ ...current, totalShots: current.totalShots + 1, hits: current.hits + (outcome.result === "miss" ? 0 : 1), shipsDestroyed: current.shipsDestroyed + (outcome.result === "sunk" ? 1 : 0) }));
    network.current?.send("shot", { coord } satisfies ShotPayload);
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

  async function createRoom() {
    if (network.current) {
      network.current.close();
    }
    const client = new PeerGameClient();
    network.current = client;
    setMatchMode("p2p");
    setPeerRole("host");
    setOpponent(waitingIdentity);
    setLocalReady(false);
    setRemoteReady(false);
    setRemoteBoardReady(null);
    bindPeerClient(client);
    client.onStatus((status) => {
      setNetworkStatus(status);
      if (status === "P2P data channel open") {
        client.send("identity", makeIdentity(profile, stats));
        client.send("settings", gameRef.current.settings);
      }
    });
    const code = await client.createRoom(makeIdentity(profile, stats));
    setRoomCode(code);
    void refreshOpenLobbies();
    updateSettings(game.settings);
    setActiveTab("play");
  }

  async function refreshOpenLobbies(): Promise<void> {
    setOpenLobbies(await listOpenLobbies());
  }

  async function joinRoom() {
    if (network.current) {
      network.current.close();
    }
    const client = new PeerGameClient();
    network.current = client;
    setMatchMode("p2p");
    setPeerRole("guest");
    setOpponent(waitingIdentity);
    setLocalReady(false);
    setRemoteReady(false);
    setRemoteBoardReady(null);
    bindPeerClient(client);
    client.onStatus((status) => {
      setNetworkStatus(status);
      if (status === "P2P data channel open") {
        client.send("identity", makeIdentity(profile, stats));
      }
    });
    await client.joinRoom(joinCode, makeIdentity(profile, stats));
    setRoomCode(joinCode.toUpperCase());
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
        const settings = message.payload as GameSettings;
        const nextConfig = getBoardConfig(settings.boardId);
        setGame((current) => ({
          ...resetBoards(current, settings),
          localBoard: randomizeFleet(nextConfig),
          selectedShipId: null
        }));
        setLocalReady(false);
        setRemoteReady(false);
        setRemoteBoardReady(null);
        setActiveTab("play");
        setNetworkStatus("Host settings received. Click ships to rotate, then Ready.");
        return;
      }

      if (message.type === "ready") {
        const payload = message.payload as ReadyPayload;
        audio.play("turn", 0.45);
        setRemoteBoardReady(payload.board);
        setRemoteReady(true);
        setGame((current) => ({ ...current, remoteBoard: payload.board }));
        setNetworkStatus(peerRoleRef.current === "host" ? "Opponent ready. Start battle." : "Host is ready.");
        return;
      }

      if (message.type === "start") {
        matchRecordedRef.current = false;
        setGame((current) => ({ ...startBattle(current, remoteBoardReadyRef.current ?? current.remoteBoard), turn: "remote" }));
        setNetworkStatus("Battle started. Host fires first.");
        setActiveTab("play");
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
    setNetworkStatus(remoteReady ? "Both fleets ready." : "Fleet ready. Waiting for opponent.");
    network.current?.send("ready", { board: game.localBoard } satisfies ReadyPayload);
  }

  function startP2PBattle() {
    if (peerRole !== "host" || !localReady || !remoteReady || !remoteBoardReady) {
      return;
    }
    matchRecordedRef.current = false;
    setGame((current) => startBattle({ ...current, remoteBoard: remoteBoardReady }, remoteBoardReady));
    network.current?.send("start", { startedAt: Date.now() });
    setNetworkStatus("Battle started. Your turn.");
    setActiveTab("play");
  }

  function receiveRemoteShot(coord: Coordinate) {
    const current = gameRef.current;
    const shot = receiveShot(current.localBoard, coord);
    if (shot.result === "duplicate") {
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
      shipId: shot.shipId,
      nextTurn,
      winner
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
    setGame((current) => {
      const shot = receiveShot(current.remoteBoard, payload.coord);
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
              Sea Battle Extended
              <span className="version-badge">{appVersion?.commit ? `v${appVersion.commit.slice(0, 7)}` : "local"}</span>
            </strong>
            <small>WebRTC fleet battles</small>
          </div>
        </button>
        <div className="top-actions">
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
          ["stats", Trophy, "Stats"]
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
              <section className="panel ship-list">
                <button
                  className="section-title collapsible-header"
                  type="button"
                  onClick={() => setFleetPanelExpanded((value) => !value)}
                  aria-expanded={fleetPanelExpanded}
                >
                  <span>Fleet</span>
                  <small>{game.localBoard.ships.length}/{config.fleet.length}</small>
                  <ChevronDown className={`collapse-chevron${fleetPanelExpanded ? " expanded" : ""}`} size={16} />
                </button>
                {fleetPanelExpanded && config.fleet.map((ship) => (
                  <button
                    className={game.selectedShipId === ship.id ? "ship-row active" : "ship-row"}
                    type="button"
                    key={ship.id}
                    onClick={() => setGame((current) => ({ ...current, selectedShipId: ship.id }))}
                  >
                    <span>{ship.name}</span>
                    <small>{ship.length} cells</small>
                  </button>
                ))}
              </section>
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
                    <small>{networkStatus}</small>
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
                      <strong>{remoteReady ? "Ready" : "Waiting"}</strong>
                    </div>
                  </div>
                  <button className="primary" type="button" disabled={!placementReady || localReady} onClick={markReady}>
                    Ready
                  </button>
                  {peerRole === "host" && (
                    <button className="secondary" type="button" disabled={!localReady || !remoteReady} onClick={startP2PBattle}>
                      Start multiplayer battle
                    </button>
                  )}
                </section>
              )}
            </>
          )}
          {(game.phase === "battle" || game.phase === "victory" || game.phase === "defeat") && (
            <>
              <section className="battle-status">
                <div>
                  <small>Opponent</small>
                  <strong>{opponent.displayName}</strong>
                </div>
                <div>
                  <small>Turn</small>
                  <strong>{game.turn === "local" ? "You" : opponent.displayName}</strong>
                </div>
                {game.settings.blitz.enabled && <div className="timer">{Math.ceil(clock)}</div>}
                <button className="icon-button stats-match-button" type="button" onClick={() => setShowOpponentStats((value) => !value)} title="Opponent stats">
                  <BarChart3 size={18} />
                  Stats
                </button>
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
                      label="Target board"
                    />
                  </div>
                  <div className="battle-board-slide battle-board-fleet" aria-hidden={battleBoardView !== "fleet"}>
                    <BoardGrid
                      board={game.localBoard}
                      revealShips
                      attackAnimation={attackVisual?.board === "local" ? attackVisual : null}
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
              <small>{networkStatus}</small>
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
                    onClick={() => {
                      setJoinCode(lobby.roomCode);
                      setRoomCode(lobby.roomCode);
                    }}
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
              <strong>{lobbyOpponent.displayName}</strong>
              <span>{lobbyOpponent.playerId === waitingIdentity.playerId ? "Create or join a room to connect." : `${lobbyOpponent.statsSummary.games} games · ${lobbyOpponent.statsSummary.winRate}% win rate`}</span>
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
        />
      )}
      {copyNotice && <div className="copy-toast" role="status">{copyNotice}</div>}
    </main>
  );
}

export { App };
