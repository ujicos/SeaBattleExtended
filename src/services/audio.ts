import { assets } from "./assets";

export class AudioManager {
  private enabled = true;
  private context: AudioContext | null = null;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  play(key: string, volume = 1): void {
    if (!this.enabled) {
      return;
    }
    if (key === "turn") {
      this.playTurnCue(volume);
      return;
    }
    const asset = assets.get(key);
    if (asset instanceof HTMLAudioElement) {
      asset.currentTime = 0;
      asset.volume = Math.max(0, Math.min(1, volume));
      void asset.play().catch(() => undefined);
    }
  }

  private playTurnCue(volume: number): void {
    try {
      this.context ??= new AudioContext();
      const now = this.context.currentTime;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(740, now);
      oscillator.frequency.exponentialRampToValueAtTime(1040, now + 0.1);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, Math.min(0.18, volume * 0.18)), now + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

      oscillator.connect(gain);
      gain.connect(this.context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.2);
    } catch {
      // Some browsers block generated audio until the next user gesture.
    }
  }
}

export const audio = new AudioManager();
