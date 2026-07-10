import { Download, ShieldAlert, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import {
  adminClearLobbies,
  adminCloseLobby,
  adminResetLeaderboard,
  clearAdminToken,
  fetchAdminStatus,
  loadAdminToken,
  saveAdminToken,
  type AdminStatus
} from "../services/network";
import { exportProfile, importProfile, type PlayerProfile, type PlayerStats } from "../services/storage";

interface ProfilePanelProps {
  profile: PlayerProfile;
  stats: PlayerStats;
  onProfileChange: (profile: PlayerProfile) => void;
  onImported: (profile: PlayerProfile, stats: PlayerStats) => void;
  adminToken: string;
  adminVerified: boolean;
  onAdminTokenChange: (token: string, remember: boolean) => void;
  onAdminVerified: (verified: boolean) => void;
}

export function ProfilePanel({
  profile,
  stats,
  onProfileChange,
  onImported,
  adminToken,
  adminVerified,
  onAdminTokenChange,
  onAdminVerified
}: ProfilePanelProps) {
  const [rememberAdminToken, setRememberAdminToken] = useState(() => loadAdminToken().remembered);
  const [adminStatus, setAdminStatus] = useState<AdminStatus | null>(null);
  const [adminMessage, setAdminMessage] = useState("");
  const [adminRoomCode, setAdminRoomCode] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);

  async function runAdminAction(action: () => Promise<void>, success: string): Promise<void> {
    if (!adminToken.trim()) {
      setAdminMessage("Paste your admin token first.");
      return;
    }
    setAdminBusy(true);
    setAdminMessage("");
    try {
      saveAdminToken(adminToken.trim(), rememberAdminToken);
      await action();
      setAdminMessage(success);
      setAdminStatus(await fetchAdminStatus(adminToken.trim()));
      onAdminVerified(true);
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : "Admin request failed.");
      onAdminVerified(false);
    } finally {
      setAdminBusy(false);
    }
  }

  function refreshAdminStatus(): Promise<void> {
    return runAdminAction(async () => {
      setAdminStatus(await fetchAdminStatus(adminToken.trim()));
    }, "Admin access verified.");
  }

  function confirmCloseRoom(roomCode: string): boolean {
    return window.confirm(`Are you sure you want to close lobby ${roomCode.trim().toUpperCase()}?`);
  }

  return (
    <div className="profile-stack">
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

      <section className="panel admin-panel">
        <div className="section-title">
          <span>Developer admin</span>
          <small>Worker protected</small>
        </div>
        <label className="field">
          Admin token
          <input
            value={adminToken}
            type="password"
            autoComplete="off"
            placeholder="Paste your rotated ADMIN_TOKEN"
            onChange={(event) => onAdminTokenChange(event.target.value, rememberAdminToken)}
          />
        </label>
        <label className="toggle-card compact-toggle">
          <input
            type="checkbox"
            checked={rememberAdminToken}
            onChange={(event) => {
              setRememberAdminToken(event.target.checked);
              onAdminTokenChange(adminToken, event.target.checked);
            }}
          />
          <span>
            <strong>Remember token</strong>
            <small>Stores it in this browser until you clear it.</small>
          </span>
        </label>
        <div className={adminVerified ? "action-row" : "action-row single-action-row"}>
          <button className="icon-button" type="button" disabled={adminBusy} onClick={() => void refreshAdminStatus()}>
            <ShieldAlert size={18} />
            Verify
          </button>
          {adminVerified && (
            <button
              className="icon-button danger-action"
              type="button"
              disabled={adminBusy}
              onClick={() => {
                if (window.confirm("Are you sure you want to clear all open lobbies?")) {
                  void runAdminAction(() => adminClearLobbies(adminToken.trim()).then(() => undefined), "Open lobbies cleared.");
                }
              }}
            >
              <Trash2 size={18} />
              Clear lobbies
            </button>
          )}
        </div>
        {adminVerified && (
          <>
            <button
              className="secondary compact-action"
              type="button"
              disabled={adminBusy}
              onClick={() => {
                clearAdminToken();
                setRememberAdminToken(false);
                onAdminTokenChange("", false);
                onAdminVerified(false);
                setAdminStatus(null);
                setAdminMessage("Admin token cleared.");
              }}
            >
              Forget admin token
            </button>
            <label className="field">
              Close room
              <div className="admin-inline-action">
                <input
                  value={adminRoomCode}
                  placeholder="ABC123"
                  maxLength={8}
                  onChange={(event) => setAdminRoomCode(event.target.value.toUpperCase())}
                />
                <button
                  className="secondary compact-action"
                  type="button"
                  disabled={adminBusy || !adminRoomCode.trim()}
                  onClick={() => {
                    if (confirmCloseRoom(adminRoomCode)) {
                      void runAdminAction(
                        () => adminCloseLobby(adminToken.trim(), adminRoomCode.trim()).then(() => undefined),
                        `Room ${adminRoomCode.trim()} closed.`
                      );
                    }
                  }}
                >
                  Close
                </button>
              </div>
            </label>
            <button
              className="secondary danger-action"
              type="button"
              disabled={adminBusy}
              onClick={() => void runAdminAction(() => adminResetLeaderboard(adminToken.trim()).then(() => undefined), "Global leaderboard reset.")}
            >
              Reset global leaderboard
            </button>
          </>
        )}
        {adminStatus && (
          <div className="admin-status-grid">
            <div>
              <small>Online</small>
              <strong>{adminStatus.onlinePlayers}</strong>
            </div>
            <div>
              <small>Games</small>
              <strong>{adminStatus.activeGames}</strong>
            </div>
            <div>
              <small>Leaderboard</small>
              <strong>{adminStatus.leaderboard?.available ? adminStatus.leaderboard.players : "off"}</strong>
            </div>
          </div>
        )}
        {adminStatus?.lobbies.length ? (
          <div className="admin-lobby-list">
            {adminStatus.lobbies.map((lobby) => (
              <button
                className="secondary compact-action"
                type="button"
                key={lobby.roomCode}
                disabled={adminBusy}
                onClick={() => {
                  if (confirmCloseRoom(lobby.roomCode)) {
                    void runAdminAction(
                      () => adminCloseLobby(adminToken.trim(), lobby.roomCode).then(() => undefined),
                      `Room ${lobby.roomCode} closed.`
                    );
                  }
                }}
              >
                Close {lobby.roomCode}{lobby.status === "full" ? " (full)" : ""}
              </button>
            ))}
          </div>
        ) : null}
        {adminMessage && <small className="admin-message">{adminMessage}</small>}
      </section>
    </div>
  );
}
