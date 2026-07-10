import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchGlobalLeaderboard, isHiddenLeaderboardName, type GlobalLeaderboardPlayer } from "../services/network";
import { getRankProgress, maxRank, xpForRank, type PlayerStats } from "../services/storage";

function percent(part: number, total: number): string {
  return total ? `${Math.round((part / total) * 100)}%` : "0%";
}

function duration(ms: number | null): string {
  if (!ms) {
    return "-";
  }
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function StatsPanel({
  stats,
  onRemoveMatch,
  onResetStats,
  onPrestige,
  showHiddenLeaderboardEntries = false,
  prestigePreview = null,
  onPrestigePreviewChange
}: {
  stats: PlayerStats;
  onRemoveMatch?: (matchId: string) => void;
  onResetStats?: () => void;
  onPrestige?: () => void;
  showHiddenLeaderboardEntries?: boolean;
  prestigePreview?: number | null;
  onPrestigePreviewChange?: (prestige: number | null) => void;
}) {
  const [globalLeaderboard, setGlobalLeaderboard] = useState<GlobalLeaderboardPlayer[]>([]);
  const [leaderboardPage, setLeaderboardPage] = useState(0);
  const rank = getRankProgress(stats.xp);
  const xpIntoRank = stats.xp - rank.currentXp;
  const xpNeeded = rank.nextXp - rank.currentXp;
  const statCards = [
    ["Rank", `${rank.rank}/${maxRank}`],
    ["Prestige", stats.prestige],
    ["Total XP", stats.lifetimeXp],
    ["Games", stats.totalGames],
    ["Wins", stats.wins],
    ["Losses", stats.losses],
    ["Win rate", percent(stats.wins, stats.totalGames)],
    ["Shots", stats.totalShots],
    ["Accuracy", percent(stats.hits, stats.totalShots)],
    ["Ships sunk", stats.shipsDestroyed],
    ["Fastest win", duration(stats.fastestWinMs)],
    ["Longest game", duration(stats.longestGameMs)]
  ];
  const leaderboardPageSize = 10;
  const visibleGlobalLeaderboard = showHiddenLeaderboardEntries
    ? globalLeaderboard
    : globalLeaderboard.filter((player) => !isHiddenLeaderboardName(player.displayName));
  const leaderboardPageCount = Math.max(1, Math.ceil(visibleGlobalLeaderboard.length / leaderboardPageSize));
  const leaderboardStart = leaderboardPage * leaderboardPageSize;
  const leaderboardPlayers = visibleGlobalLeaderboard.slice(leaderboardStart, leaderboardStart + leaderboardPageSize);

  useEffect(() => {
    let active = true;
    void fetchGlobalLeaderboard().then((players) => {
      if (active) {
        setGlobalLeaderboard(players);
        setLeaderboardPage((page) => Math.min(page, Math.max(0, Math.ceil(players.length / leaderboardPageSize) - 1)));
      }
    });
    return () => {
      active = false;
    };
  }, [stats.lifetimeXp]);

  useEffect(() => {
    setLeaderboardPage((page) => Math.min(page, leaderboardPageCount - 1));
  }, [leaderboardPageCount]);

  return (
    <section className="panel">
      <div className="section-title">
        <span>Statistics</span>
        <small>Rank {rank.rank}</small>
      </div>
      <div className="rank-panel">
        <div>
          <small>Level progress</small>
          <strong>{rank.rank === maxRank ? "Max rank reached" : `${xpIntoRank}/${xpNeeded} XP`}</strong>
        </div>
        <div className="xp-bar" aria-label={`Rank progress ${Math.round(rank.progress * 100)}%`}>
          <span style={{ width: `${Math.round(rank.progress * 100)}%` }} />
        </div>
        {onPrestige && (
          <button className="secondary prestige-button" type="button" disabled={rank.rank < maxRank} onClick={onPrestige}>
            Prestige
          </button>
        )}
        <small>{rank.rank < maxRank ? `${xpForRank(rank.rank + 1) - stats.xp} XP to next rank` : "Prestige resets rank XP and keeps total XP."}</small>
      </div>
      {onResetStats && (
        <button className="secondary reset-stats-button" type="button" onClick={onResetStats}>
          Reset stats
        </button>
      )}
      {onPrestigePreviewChange && (
        <label className="field prestige-preview-field">
          Prestige effect preview
          <select
            value={prestigePreview ?? ""}
            onChange={(event) => onPrestigePreviewChange(event.target.value === "" ? null : Number(event.target.value))}
          >
            <option value="">Actual prestige</option>
            {Array.from({ length: 11 }, (_, prestige) => (
              <option value={prestige} key={prestige}>Preview prestige {prestige}</option>
            ))}
          </select>
        </label>
      )}
      <div className="stats-grid">
        {statCards.map(([label, value]) => (
          <div className="stat" key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="leaderboard-panel">
        <div className="section-title">
          <span>Global leaderboard</span>
          <small>{visibleGlobalLeaderboard.length ? `Page ${leaderboardPage + 1}/${leaderboardPageCount}` : "D1"}</small>
        </div>
        {visibleGlobalLeaderboard.length ? (
          leaderboardPlayers.map((player, index) => {
            const hiddenDeveloper = isHiddenLeaderboardName(player.displayName);
            const prestigeClass = player.prestige ? `prestige-name prestige-${Math.min(10, player.prestige)}` : undefined;
            return (
              <div className={hiddenDeveloper ? "leaderboard-row developer-row" : "leaderboard-row"} key={player.playerId}>
                <span className={prestigeClass}>
                  #{leaderboardStart + index + 1} {player.displayName}{hiddenDeveloper ? <em>DEV</em> : null}
                </span>
                <strong>P{player.prestige} R{player.rank}</strong>
                <small>{player.lifetimeXp} XP</small>
              </div>
            );
          })
        ) : (
          <div className="leaderboard-row">
            <span>No global ranks yet</span>
            <strong>-</strong>
            <small>D1</small>
          </div>
        )}
        {visibleGlobalLeaderboard.length > leaderboardPageSize && (
          <div className="leaderboard-controls">
            <button className="secondary compact-action" type="button" disabled={leaderboardPage === 0} onClick={() => setLeaderboardPage((page) => Math.max(0, page - 1))}>
              Previous
            </button>
            <small>{leaderboardStart + 1}-{Math.min(visibleGlobalLeaderboard.length, leaderboardStart + leaderboardPageSize)} of {visibleGlobalLeaderboard.length}</small>
            <button className="secondary compact-action" type="button" disabled={leaderboardPage >= leaderboardPageCount - 1} onClick={() => setLeaderboardPage((page) => Math.min(leaderboardPageCount - 1, page + 1))}>
              Next
            </button>
          </div>
        )}
      </div>
      <div className="history">
        {stats.history.slice(0, 5).map((match) => (
          <div className="history-row" key={match.id}>
            <div>
              <span>{match.result.toUpperCase()} vs {match.opponent.displayName}</span>
              <small>{match.boardSize}x{match.boardSize} · {match.moves} moves</small>
            </div>
            {onRemoveMatch && (
              <button
                className="icon-button history-remove-button"
                type="button"
                title="Remove this match (e.g. a duplicated win)"
                aria-label="Remove this match from history"
                onClick={() => onRemoveMatch(match.id)}
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
