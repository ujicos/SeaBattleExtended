import { X } from "lucide-react";
import type { PlayerStats } from "../services/storage";

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

export function StatsPanel({ stats, onRemoveMatch }: { stats: PlayerStats; onRemoveMatch?: (matchId: string) => void }) {
  const statCards = [
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

  return (
    <section className="panel">
      <div className="section-title">
        <span>Statistics</span>
        <small>Local only</small>
      </div>
      <div className="stats-grid">
        {statCards.map(([label, value]) => (
          <div className="stat" key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
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
