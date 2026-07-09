import { X } from "lucide-react";
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
  onPrestige
}: {
  stats: PlayerStats;
  onRemoveMatch?: (matchId: string) => void;
  onResetStats?: () => void;
  onPrestige?: () => void;
}) {
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
  const opponentLeaderboard = Object.entries(stats.opponents)
    .map(([playerId, opponent]) => ({
      playerId,
      ...opponent,
      winRate: opponent.games ? Math.round((opponent.wins / opponent.games) * 100) : 0
    }))
    .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || b.games - a.games)
    .slice(0, 5);

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
          <span>Rank leaderboard</span>
          <small>local</small>
        </div>
        <div className="leaderboard-row self">
          <span>#1 You</span>
          <strong>Rank {rank.rank}</strong>
          <small>{stats.lifetimeXp} XP</small>
        </div>
        {opponentLeaderboard.map((opponent, index) => (
          <div className="leaderboard-row" key={opponent.playerId}>
            <span>#{index + 2} {opponent.displayName}</span>
            <strong>{opponent.wins} wins</strong>
            <small>{opponent.winRate}% WR</small>
          </div>
        ))}
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
