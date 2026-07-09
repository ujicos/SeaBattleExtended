import { ChevronDown, RotateCw, Shuffle } from "lucide-react";
import { boardConfigs } from "../game/config";
import type { GameSettings } from "../types/game";

interface SetupPanelProps {
  settings: GameSettings;
  onSettings: (settings: GameSettings) => void;
  onRotate: () => void;
  onShuffle: () => void;
  onStart: () => void;
  ready: boolean;
  readOnly?: boolean;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  showPlacementControls?: boolean;
  showStart?: boolean;
}

export function SetupPanel({
  settings,
  onSettings,
  onRotate,
  onShuffle,
  onStart,
  ready,
  readOnly = false,
  expanded = true,
  onToggleExpanded,
  showPlacementControls = true,
  showStart = true
}: SetupPanelProps) {
  return (
    <section className="panel">
      <button className="section-title setup-title-button" type="button" onClick={onToggleExpanded} aria-expanded={expanded}>
        <span>Game setup</span>
        <ChevronDown className={`collapse-chevron${expanded ? " expanded" : ""}`} size={16} />
      </button>
      {expanded && (
        <>
          {readOnly && <p className="readonly-note">Host controls these settings.</p>}
          <label className="field">
            Board
            <select disabled={readOnly} value={settings.boardId} onChange={(event) => onSettings({ ...settings, boardId: event.target.value })}>
              {boardConfigs.map((board) => (
                <option value={board.id} key={board.id}>{board.label}</option>
              ))}
            </select>
          </label>
          <div className="modifier-grid">
            <label className="toggle modifier-toggle">
              <input
                type="checkbox"
                disabled={readOnly}
                checked={settings.blitz.enabled}
                onChange={(event) => onSettings({ ...settings, blitz: { ...settings.blitz, enabled: event.target.checked } })}
              />
              <span>
                <strong>Blitz Mode</strong>
                <small>Timed turns with configurable timeout rules.</small>
              </span>
            </label>
            {settings.blitz.enabled && (
              <div className="setup-grid modifier-options">
                <label className="field">
                  Turn timer
                  <select
                    disabled={readOnly}
                    value={settings.blitz.seconds}
                    onChange={(event) => onSettings({ ...settings, blitz: { ...settings.blitz, seconds: Number(event.target.value) as 5 | 10 | 15 | 30 } })}
                  >
                    {[5, 10, 15, 30].map((seconds) => <option key={seconds}>{seconds}</option>)}
                  </select>
                </label>
                <label className="field">
                  Timeout
                  <select
                    disabled={readOnly}
                    value={settings.blitz.timeoutAction}
                    onChange={(event) => onSettings({ ...settings, blitz: { ...settings.blitz, timeoutAction: event.target.value as "lose-turn" | "lose-match" } })}
                  >
                    <option value="lose-turn">Lose turn</option>
                    <option value="lose-match">Lose match</option>
                  </select>
                </label>
              </div>
            )}
            <label className="toggle modifier-toggle">
              <input
                type="checkbox"
                disabled={readOnly}
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
                disabled={readOnly}
                checked={settings.modifiers.stormMode}
                onChange={(event) => onSettings({ ...settings, modifiers: { ...settings.modifiers, stormMode: event.target.checked } })}
              />
              <span>
                <strong>Storm Mode</strong>
                <small>Storm waves can nudge unhit ships.</small>
              </span>
            </label>
            <label className="toggle modifier-toggle">
              <input
                type="checkbox"
                disabled={readOnly}
                checked={settings.modifiers.treasureTiles}
                onChange={(event) => onSettings({ ...settings, modifiers: { ...settings.modifiers, treasureTiles: event.target.checked } })}
              />
              <span>
                <strong>Treasure Tiles</strong>
                <small>Hidden treasure grants a shield for the next hit.</small>
              </span>
            </label>
            <label className="toggle modifier-toggle">
              <input
                type="checkbox"
                disabled={readOnly}
                checked={settings.modifiers.pirateChaos}
                onChange={(event) => onSettings({ ...settings, modifiers: { ...settings.modifiers, pirateChaos: event.target.checked } })}
              />
              <span>
                <strong>Pirate Chaos</strong>
                <small>Fake treasure and cursed cannonballs.</small>
              </span>
            </label>
          </div>
          {showPlacementControls && (
            <div className="action-row">
              <button className="icon-button" type="button" onClick={onRotate} title="Rotate selected ship">
                <RotateCw size={18} /> Rotate
              </button>
              <button className="icon-button" type="button" onClick={onShuffle} title="Shuffle ships">
                <Shuffle size={18} /> Shuffle
              </button>
            </div>
          )}
          {showStart && <button className="primary" type="button" disabled={!ready} onClick={onStart}>Start practice battle</button>}
        </>
      )}
    </section>
  );
}
