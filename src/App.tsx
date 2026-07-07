import { Anchor, BarChart3, Menu, Radio, Settings, Shield, Trophy, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BoardGrid } from "./components/BoardGrid";
import type { AttackAnimation } from "./components/BoardGrid";
import { ProfilePanel } from "./components/ProfilePanel";
import { SetupPanel } from "./components/SetupPanel";
import { StatsPanel } from "./components/StatsPanel";
import { canPlaceShip, getShipCells, placeShip, randomizeFleet } from "./game/board";
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
import type { Coordinate, GameSettings, Orientation, PeerIdentity } from "./types/game";

const guestIdentity: PeerIdentity = {
  playerId: "local_ai",
  displayName: "Practice Fleet",
  avatar: "radar",
  statsSummary: { games: 0, wins: 0, losses: 0, winRate: 0 }
};

function nextUnplacedShipId(settings: GameSettings, placedIds: Set<string>): string | null {
  return getBoardConfig(settings.boardId).fleet.find((ship) => !placedIds.has(ship.id))?.id ?? null;
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [showOpponentStats, setShowOpponentStats] = useState(false);
  const [attackVisual, setAttackVisual] = useState<(AttackAnimation & { board: "local" | "remote" }) | null>(null);
  const network = useRef<PeerGameClient | null>(null);

  const config = useMemo(() => getBoardConfig(game.settings.boardId), [game.settings.boardId]);
  const selectedShip = config.fleet.find((ship) => ship.id === game.selectedShipId);
  const placedIds = useMemo(() => new Set(game.localBoard.ships.map((ship) => ship.id)), [game.localBoard.ships]);
  const placementReady = game.localBoard.ships.length === config.fleet.length;
  const opponentRecord = stats.opponents[opponent.playerId];
  const preview =
    hovered && selectedShip && game.phase === "placing"
      ? {
          cells: getShipCells({ ...selectedShip, origin: hovered, orientation }),
          valid: canPlaceShip(game.localBoard, selectedShip, hovered, orientation, selectedShip.id)
        }
      : null;

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
    setGame((current) => resetBoards(current, settings));
  }

  function placeSelectedShip(coord: Coordinate) {
    if (!selectedShip || game.phase !== "placing") {
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
    setGame((current) => ({ ...current, localBoard: board, selectedShipId: nextUnplacedShipId(current.settings, new Set(board.ships.map((ship) => ship.id))) }));
  }

  function beginLocalBattle() {
    const remoteBoard = randomizeFleet(config);
    setOpponent(guestIdentity);
    setGame((current) => startBattle(current, remoteBoard));
  }

  function fire(coord: Coordinate) {
    if (game.turn !== "local") {
      return;
    }
    const { state, outcome } = attack(game, "remote", coord);
    if (outcome.result === "invalid" || outcome.result === "duplicate") {
      return;
    }
    playAttackVisual("remote", coord, outcome.result);
    audio.play(outcome.result === "miss" ? "miss" : "hit");
    setGame(state);
    setStats((current) => ({ ...current, totalShots: current.totalShots + 1, hits: current.hits + (outcome.result === "miss" ? 0 : 1), shipsDestroyed: current.shipsDestroyed + (outcome.result === "sunk" ? 1 : 0) }));
    network.current?.send("shot", coord);
    if (outcome.winner) {
      endMatch("win", state);
      return;
    }
    if (outcome.nextTurn === "remote") {
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
    client.onStatus(setNetworkStatus);
    client.onMessage((message) => {
      if (message.type === "identity") {
        const remote = message.payload as PeerIdentity;
        if (remote.displayName.trim().toLowerCase() === profile.displayName.trim().toLowerCase()) {
          setNetworkStatus("Duplicate display name. Change one name before connecting.");
          client.close();
          return;
        }
        setOpponent(remote);
      }
    });
    const code = await client.createRoom(makeIdentity(profile, stats));
    setRoomCode(code);
    client.send("identity", makeIdentity(profile, stats));
  }

  async function joinRoom() {
    if (network.current) {
      network.current.close();
    }
    const client = new PeerGameClient();
    network.current = client;
    client.onStatus(setNetworkStatus);
    await client.joinRoom(joinCode, makeIdentity(profile, stats));
    client.send("identity", makeIdentity(profile, stats));
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <Anchor />
          <div>
            <strong>Sea Battle Extended</strong>
            <small>120Hz-ready WebRTC battles</small>
          </div>
        </div>
        <div className="top-actions">
          <div className="player-chip">
            <UserRound size={18} />
            {profile.displayName}
          </div>
          <button className="menu-button" type="button" title="Open menu" onClick={() => setMenuOpen((value) => !value)}>
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </header>

      {menuOpen && (
        <nav className="tabbar">
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
              onClick={() => {
                setActiveTab(key as typeof activeTab);
                setMenuOpen(false);
              }}
            >
              <Icon size={19} />
              <span>{label as string}</span>
            </button>
          ))}
        </nav>
      )}

      {activeTab === "play" && (
        <div className={game.phase === "battle" || game.phase === "victory" || game.phase === "defeat" ? "content-grid battle-grid" : "content-grid setup-focus"}>
          <SetupPanel
            settings={game.settings}
            orientation={orientation}
            onSettings={updateSettings}
            onRotate={() => setOrientation((value) => (value === "horizontal" ? "vertical" : "horizontal"))}
            onShuffle={shuffle}
            onStart={beginLocalBattle}
            ready={placementReady}
          />
          {game.phase === "menu" && (
            <section className="panel hero-panel">
              <h1>Ready your fleet.</h1>
              <p>Choose a board, shuffle or place each ship, then launch a practice battle. P2P rooms are available in Lobby.</p>
              <button className="primary" type="button" onClick={() => updateSettings(game.settings)}>Place ships</button>
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
                interactive
                preview={preview}
                selectedShip={selectedShip}
                orientation={orientation}
                onCellPress={placeSelectedShip}
                onCellHover={setHovered}
                label="Your waters"
              />
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
              <BoardGrid
                board={game.remoteBoard}
                revealShips={game.phase !== "battle"}
                interactive={game.phase === "battle" && game.turn === "local"}
                onCellPress={fire}
                attackAnimation={attackVisual?.board === "remote" ? attackVisual : null}
                label="Target board"
              />
              <BoardGrid
                board={game.localBoard}
                revealShips
                compact
                attackAnimation={attackVisual?.board === "local" ? attackVisual : null}
                label="Your board"
              />
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
