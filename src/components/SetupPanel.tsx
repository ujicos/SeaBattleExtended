import { RotateCw, Shuffle, TimerReset } from "lucide-react";
import { boardConfigs } from "../game/config";
import type { GameSettings, Orientation } from "../types/game";

interface SetupPanelProps {
  settings: GameSettings;
  orientation: Orientation;
  onSettings: (settings: GameSettings) => void;
  onRotate: () => void;
  onShuffle: () => void;
  onStart: () => void;
  ready: boolean;
}

export function SetupPanel({ settings, orientation, onSettings, onRotate, onShuffle, onStart, ready }: SetupPanelProps) {
  return (
    <section className="panel">
      <div className="section-title">
        <span>Game setup</span>
        <small>{orientation}</small>
      </div>
      <label className="field">
        Board
        <select value={settings.boardId} onChange={(event) => onSettings({ ...settings, boardId: event.target.value })}>
          {boardConfigs.map((board) => (
            <option value={board.id} key={board.id}>{board.label}</option>
          ))}
        </select>
      </label>
      <div className="segmented">
        {(["classic", "extended"] as const).map((mode) => (
          <button
            className={settings.mode === mode ? "active" : ""}
            type="button"
            key={mode}
            onClick={() => onSettings({ ...settings, mode })}
          >
            {mode}
          </button>
        ))}
      </div>
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.blitz.enabled}
          onChange={(event) => onSettings({ ...settings, blitz: { ...settings.blitz, enabled: event.target.checked } })}
        />
        <TimerReset size={18} />
        Blitz mode
      </label>
      {settings.blitz.enabled && (
        <div className="setup-grid">
          <label className="field">
            Turn timer
            <select
              value={settings.blitz.seconds}
              onChange={(event) => onSettings({ ...settings, blitz: { ...settings.blitz, seconds: Number(event.target.value) as 5 | 10 | 15 | 30 } })}
            >
              {[5, 10, 15, 30].map((seconds) => <option key={seconds}>{seconds}</option>)}
            </select>
          </label>
          <label className="field">
            Timeout
            <select
              value={settings.blitz.timeoutAction}
              onChange={(event) => onSettings({ ...settings, blitz: { ...settings.blitz, timeoutAction: event.target.value as "lose-turn" | "lose-match" } })}
            >
              <option value="lose-turn">Lose turn</option>
              <option value="lose-match">Lose match</option>
            </select>
          </label>
        </div>
      )}
      <div className="modifier-grid">
        <label className="toggle modifier-toggle">
          <input
            type="checkbox"
            checked={settings.modifiers.fogTide}
            onChange={(event) => onSettings({ ...settings, modifiers: { ...settings.modifiers, fogTide: event.target.checked } })}
          />
          <span>
            <strong>Fog Tide</strong>
            <small>Temporary fog rolls over the target board.</small>
          </span>
        </label>
        <label className="toggle modifier-toggle">
          <input
            type="checkbox"
            checked={settings.modifiers.stormMode}
            onChange={(event) => onSettings({ ...settings, modifiers: { ...settings.modifiers, stormMode: event.target.checked } })}
          />
          <span>
            <strong>Storm Mode</strong>
            <small>Storm waves can nudge unhit ships.</small>
          </span>
        </label>
      </div>
      <div className="action-row">
        <button className="icon-button" type="button" onClick={onRotate} title="Rotate selected ship">
          <RotateCw size={18} /> Rotate
        </button>
        <button className="icon-button" type="button" onClick={onShuffle} title="Shuffle ships">
          <Shuffle size={18} /> Shuffle
        </button>
      </div>
      <button className="primary" type="button" disabled={!ready} onClick={onStart}>Start practice battle</button>
    </section>
  );
}
