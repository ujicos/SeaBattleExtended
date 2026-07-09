import { Lock, Trophy } from "lucide-react";
import { achievements, type PlayerStats } from "../services/storage";

interface AchievementsPanelProps {
  stats: PlayerStats;
  canRevealHidden?: boolean;
  revealHidden?: boolean;
  onRevealHiddenChange?: (reveal: boolean) => void;
}

export function AchievementsPanel({ stats, canRevealHidden = false, revealHidden = false, onRevealHiddenChange }: AchievementsPanelProps) {
  const unlockedCount = achievements.filter((achievement) => stats.achievements[achievement.id]).length;

  return (
    <section className="panel">
      <div className="section-title">
        <span>Achievements</span>
        <small>{unlockedCount}/{achievements.length}</small>
      </div>
      {canRevealHidden && (
        <label className="toggle-card compact-toggle achievement-reveal-toggle">
          <input type="checkbox" checked={revealHidden} onChange={(event) => onRevealHiddenChange?.(event.target.checked)} />
          <span>
            <strong>Reveal hidden achievements</strong>
            <small>Admin-only preview; does not unlock them.</small>
          </span>
        </label>
      )}
      <div className="achievement-grid">
        {achievements.map((achievement) => {
          const unlockedAt = stats.achievements[achievement.id];
          const lockedHidden = achievement.hidden && !unlockedAt && !revealHidden;
          return (
            <div className={unlockedAt ? "achievement-card unlocked" : "achievement-card"} key={achievement.id}>
              {unlockedAt ? <Trophy size={22} /> : <Lock size={22} />}
              <div>
                <strong>{lockedHidden ? "Hidden achievement" : achievement.title}</strong>
                <small>{lockedHidden ? "Keep playing to discover this." : achievement.description}</small>
                {unlockedAt && <small>Unlocked {new Date(unlockedAt).toLocaleDateString()}</small>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
