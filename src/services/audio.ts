import { assets } from "./assets";

export class AudioManager {
  private enabled = true;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  play(key: string): void {
    if (!this.enabled) {
      return;
    }
    const asset = assets.get(key);
    if (asset instanceof HTMLAudioElement) {
      asset.currentTime = 0;
      void asset.play().catch(() => undefined);
    }
  }
}

export const audio = new AudioManager();
