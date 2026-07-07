import { Download, Upload } from "lucide-react";
import { exportProfile, importProfile, type PlayerProfile, type PlayerStats } from "../services/storage";

interface ProfilePanelProps {
  profile: PlayerProfile;
  stats: PlayerStats;
  onProfileChange: (profile: PlayerProfile) => void;
  onImported: (profile: PlayerProfile, stats: PlayerStats) => void;
}

export function ProfilePanel({ profile, stats, onProfileChange, onImported }: ProfilePanelProps) {
  return (
    <section className="panel">
      <div className="section-title">
        <span>Profile</span>
        <small>{profile.playerId}</small>
      </div>
      <label className="field">
        Display name
        <input
          value={profile.displayName}
          maxLength={24}
          onChange={(event) => onProfileChange({ ...profile, displayName: event.target.value })}
        />
      </label>
      <label className="field">
        Avatar token
        <input value={profile.avatar} maxLength={18} onChange={(event) => onProfileChange({ ...profile, avatar: event.target.value })} />
      </label>
      <div className="action-row">
        <button
          className="icon-button"
          type="button"
          title="Export profile"
          onClick={() => navigator.clipboard?.writeText(exportProfile(profile, stats))}
        >
          <Download size={18} />
          Export
        </button>
        <label className="icon-button file-button" title="Import profile">
          <Upload size={18} />
          Import
          <input
            type="file"
            accept="application/json"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) {
                return;
              }
              const bundle = importProfile(await file.text());
              onImported(bundle.profile, bundle.stats);
            }}
          />
        </label>
      </div>
    </section>
  );
}
