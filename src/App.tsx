import { Anchor, BarChart3, Radio, Settings, Shield, Trophy, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BoardGrid } from "./components/BoardGrid";
import type { AttackAnimation } from "./components/BoardGrid";
import { ProfilePanel } from "./components/ProfilePanel";
import { SetupPanel } from "./components/SetupPanel";
import { StatsPanel } from "./components/StatsPanel";
import { allShipsSunk, canPlaceShip, coordKey, findShipAt, getShipCells, placeShip, randomizeFleet, receiveShot } from "./game/board";
import { boardConfigs, defaultSettings, getBoardConfig } from "./game/config";
import { attack, createInitialGame, resetBoards, startBattle } from "./game/engine";
import { rafLoop } from "./game/animation";
import { assets } from "./services/assets";
import { audio } from "./services/audio";
import { PeerGameClient } from "./services/network";
import {
  loadProfile,
  loadStats,
  makeIdentity,
  recordMatch,
  saveProfile,
  saveStats,
  type PlayerProfile,
  type PlayerStats
} from "./services/storage";
import type { BoardState, Coordinate, GameSettings, GameState, Orientation, PeerIdentity, PlayerSide, ShotResult } from "./types/game";

const guestIdentity: PeerIdentity = {
  playerId: "local_ai",
  displayName: "Practice Fleet",
  avatar: "radar",
  statsSummary: { games: 0, wins: 0, losses: 0, winRate: 0 }
};

function nextUnplacedShipId(settings: GameSettings, placedIds: Set<string>): string | null {
  return getBoardConfig(settings.boardId).fleet.find((ship) => !placedIds.has(ship.id))?.id ?? null;
}

type MatchMode = "practice" | "p2p";
type PeerRole = "host" | "guest" | null;
type BattleBoardView = "target" | "fleet";

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
  const [showOpponentStats, setShowOpponentStats] = useState(false);
  const [attackVisual, setAttackVisual] = useState<(AttackAnimation & { board: "local" | "remote" }) | null>(null);
  const [matchMode, setMatchMode] = useState<MatchMode>("practice");
  const [peerRole, setPeerRole] = useState<PeerRole>(null);
  const [localReady, setLocalReady] = useState(false);
  const [remoteReady, setRemoteReady] = useState(false);
  const [remoteBoardReady, setRemoteBoardReady] = useState<BoardState | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<Coordinate | null>(null);
  const [battleBoardView, setBattleBoardView] = useState<BattleBoardView>("target");
  const network = useRef<PeerGameClient | null>(null);
  const gameRef = useRef(game);
  const peerRoleRef = useRef<PeerRole>(null);
  const opponentRef = useRef(opponent);
  const remoteBoardReadyRef = useRef<BoardState | null>(null);

  const config = useMemo(() => getBoardConfig(game.settings.boardId), [game.settings.boardId]);
  const selectedShip = config.fleet.find((ship) => ship.id === game.selectedShipId);
  const placedIds = useMemo(() => new Set(game.localBoard.ships.map((ship) => ship.id)), [game.localBoard.ships]);
  const placementReady = game.localBoard.ships.length === config.fleet.length;
  const opponentRecord = stats.opponents[opponent.playerId];
  const matchActive = game.phase === "battle" || game.phase === "victory" || game.phase === "defeat";
  const preview =
    hovered && selectedShip && game.phase === "placing"
      ? {
          cells: getShipCells({ ...selectedShip, origin: hovered, orientation }),
          valid: canPlaceShip(game.localBoard, selectedShip, hovered, orientation, selectedShip.id)
        }
      : null;

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

  function playAttackVisual(board: "local" | "remote", coord: Coordinate, result: AttackAnimation["result"]) {
    setAttackVisual({
      id: crypto.randomUUID(),
      board,
      coord,
      direction: attackDirection(coord),
      result
    });
    window.setTimeout(() => setAttackVisual((current) => (current?.coord === coord && current.board === board ? null : current)), 920);
  }

  function showBattleBoard(view: BattleBoardView, holdMs = 0) {
    setBattleBoardView(view);
    if (holdMs > 0) {
      window.setTimeout(() => {
        const current = gameRef.current;
        if (current.phase === "battle" && current.turn === "local") {
          setBattleBoardView("target");
        }
      }, holdMs);
    }
  }

  useEffect(() => {
    assets.preload();
  }, []);

  useEffect(() => {
    saveProfile(profile);
  }, [profile]);

  useEffect(() => {
    saveStats(stats);
  }, [stats]);

  useEffect(() => {
    return rafLoop(() => {
      if (game.phase !== "battle" || !game.settings.blitz.enabled) {
        return;
      }
      setClock((value) => Math.max(0, value - 1 / 120));
    });
  }, [game.phase, game.settings.blitz.enabled]);

  useEffect(() => {
    if (game.phase === "battle") {
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
      endMatch(game.turn === "local" ? "loss" : "win");
      setGame((current) => ({ ...current, phase: game.turn === "local" ? "defeat" : "victory", winner: game.turn === "local" ? "remote" : "local" }));
    } else {
      setGame((current) => ({ ...current, turn: current.turn === "local" ? "remote" : "local" }));
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
  }

  function placeSelectedShip(coord: Coordinate) {
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
  }

  function shuffle() {
    const board = randomizeFleet(config);
    setLocalReady(false);
    setGame((current) => ({ ...current, localBoard: board, selectedShipId: nextUnplacedShipId(current.settings, new Set(board.ships.map((ship) => ship.id))) }));
  }

  function beginLocalBattle() {
    const remoteBoard = randomizeFleet(config);
    setMatchMode("practice");
    setOpponent(guestIdentity);
    setGame((current) => startBattle(current, remoteBoard));
  }

  function selectTarget(coord: Coordinate) {
    if (game.phase !== "battle" || game.turn !== "local") {
      return;
    }
    if (game.remoteBoard.shots[coordKey(coord)]) {
      return;
    }
    setSelectedTarget(coord);
  }

  function fireSelectedTarget() {
    if (!selectedTarget) {
      return;
    }
    fire(selectedTarget);
  }

  function fire(coord: Coordinate) {
    if (game.turn !== "local") {
      return;
    }
    const { state, outcome } = attack(game, "remote", coord);
    if (outcome.result === "invalid" || outcome.result === "duplicate") {
      return;
    }
    setSelectedTarget(null);
    showBattleBoard("fleet", outcome.nextTurn === "local" ? 1400 : 0);
    playAttackVisual("remote", coord, outcome.result);
    audio.play(outcome.result === "miss" ? "miss" : "hit");
    setGame(state);
    setStats((current) => ({ ...current, totalShots: current.totalShots + 1, hits: current.hits + (outcome.result === "miss" ? 0 : 1), shipsDestroyed: current.shipsDestroyed + (outcome.result === "sunk" ? 1 : 0) }));
    network.current?.send("shot", coord);
    if (outcome.winner) {
      endMatch("win", state);
      return;
    }
    if (matchMode === "practice" && outcome.nextTurn === "remote") {
      window.setTimeout(() => remoteTurn(state), 450);
    }
  }

  function remoteTurn(currentGame = game) {
    const openCells = Array.from({ length: config.size * config.size }, (_, index) => ({
      row: Math.floor(index / config.size),
      col: index % config.size
    })).filter((coord) => !currentGame.localBoard.shots[`${coord.row}:${coord.col}`]);
    const pick = openCells[Math.floor(Math.random() * openCells.length)];
    if (!pick) {
      return;
    }
    const { state, outcome } = attack(currentGame, "local", pick);
    if (outcome.result !== "invalid" && outcome.result !== "duplicate") {
      playAttackVisual("local", pick, outcome.result);
      showBattleBoard("fleet", outcome.nextTurn === "local" ? 1500 : 0);
    }
    setGame(state);
    if (outcome.winner) {
      endMatch("loss", state);
      return;
    }
    if (outcome.nextTurn === "remote") {
      window.setTimeout(() => remoteTurn(state), 520);
    }
  }

  function endMatch(result: "win" | "loss", state = game) {
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
    updateSettings(game.settings);
    setActiveTab("play");
  }

  async function joinRoom() {
    if (network.current) {
      network.current.close();
    }
    const client = new PeerGameClient();
    network.current = client;
    setMatchMode("p2p");
    setPeerRole("guest");
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
        setRemoteBoardReady(payload.board);
        setRemoteReady(true);
        setGame((current) => ({ ...current, remoteBoard: payload.board }));
        setNetworkStatus(peerRoleRef.current === "host" ? "Opponent ready. Start battle." : "Host is ready.");
        return;
      }

      if (message.type === "start") {
        setGame((current) => ({ ...startBattle(current, remoteBoardReadyRef.current ?? current.remoteBoard), turn: "remote" }));
        setNetworkStatus("Battle started. Host fires first.");
        setActiveTab("play");
        return;
      }

      if (message.type === "shot") {
        receiveRemoteShot((message.payload as ShotPayload).coord);
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
    setLocalReady(true);
    setNetworkStatus(remoteReady ? "Both fleets ready." : "Fleet ready. Waiting for opponent.");
    network.current?.send("ready", { board: game.localBoard } satisfies ReadyPayload);
  }

  function startP2PBattle() {
    if (peerRole !== "host" || !localReady || !remoteReady || !remoteBoardReady) {
      return;
    }
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
    playAttackVisual("local", coord, shot.result);
    const winner: PlayerSide | null = allShipsSunk(shot.board) ? "remote" : null;
    const nextTurn: PlayerSide = shot.result === "miss" ? "local" : "remote";
    showBattleBoard("fleet", nextTurn === "local" ? 1500 : 0);
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
    setGame(nextState);
    network.current?.send("shot-result", {
      coord,
      result: shot.result,
      shipId: shot.shipId,
      nextTurn,
      winner
    } satisfies ShotResultPayload);
    if (winner) {
      endMatch("loss", nextState);
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
      }
      showBattleBoard("fleet", nextTurn === "local" && !nextWinner ? 1400 : 0);
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
            <strong>Sea Battle Extended</strong>
            <small>120Hz-ready WebRTC battles</small>
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
                <div className="section-title">
                  <span>Fleet</span>
                  <small>{game.localBoard.ships.length}/{config.fleet.length}</small>
                </div>
                {config.fleet.map((ship) => (
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
                        <button className="secondary compact-action" type="button" onClick={() => void navigator.clipboard?.writeText(roomCode)}>
                          Copy
                        </button>
                      )}
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
                <div className="fire-controls">
                  <div>
                    <small>Selected target</small>
                    <strong>{selectedTarget ? `R${selectedTarget.row + 1} C${selectedTarget.col + 1}` : "Tap a square"}</strong>
                  </div>
                  <button className="primary fire-button" type="button" disabled={game.phase !== "battle" || game.turn !== "local" || battleBoardView !== "target" || !selectedTarget} onClick={fireSelectedTarget}>
                    Fire!
                  </button>
                </div>
              </section>
              <div className={`battle-board-stage showing-${battleBoardView}`}>
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
            </>
          )}
          {(game.phase === "victory" || game.phase === "defeat") && (
            <section className={game.phase === "victory" ? "result victory" : "result defeat"}>
              <h2>{game.phase === "victory" ? "Victory" : "Defeat"}</h2>
              <button className="primary" type="button" onClick={() => setGame((current) => resetBoards(current, current.settings))}>Rematch</button>
            </section>
          )}
        </div>
      )}

      {activeTab === "lobby" && (
        <div className="content-grid">
          <section className="panel">
            <div className="section-title">
              <span>P2P Lobby</span>
              <small>{networkStatus}</small>
            </div>
            <button className="primary" type="button" onClick={() => void createRoom()}>Create Game</button>
            {roomCode && <div className="room-code">{roomCode}</div>}
            <label className="field">
              Join code
              <input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="ABC123" />
            </label>
            <button className="secondary" type="button" onClick={() => void joinRoom()}>Join Game</button>
          </section>
          <section className="panel">
            <div className="section-title">
              <span>Opponent</span>
              <small>{opponent.playerId}</small>
            </div>
            <div className="opponent-card">
              <strong>{opponent.displayName}</strong>
              <span>{opponent.statsSummary.games} games · {opponent.statsSummary.winRate}% win rate</span>
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
      {activeTab === "stats" && <StatsPanel stats={stats} />}
    </main>
  );
}

export { App };
