import { assets } from "./assets";

export class AudioManager {
  private enabled = true;
  private context: AudioContext | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly pendingBuffers = new Map<string, Promise<AudioBuffer | null>>();

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
    void this.playBuffer(key, volume);
  }

  private async getContext(): Promise<AudioContext | null> {
    try {
      this.context ??= new AudioContext();
      if (this.context.state === "suspended") {
        await this.context.resume();
      }
      return this.context;
    } catch {
      return null;
    }
  }

  private loadBuffer(key: string): Promise<AudioBuffer | null> {
    const existing = this.buffers.get(key);
    if (existing) {
      return Promise.resolve(existing);
    }

    const pending = this.pendingBuffers.get(key);
    if (pending) {
      return pending;
    }

    const path = assets.getPath(key);
    if (!path) {
      return Promise.resolve(null);
    }

    const request = (async () => {
      const context = await this.getContext();
      if (!context) {
        return null;
      }
      const response = await fetch(path);
      const data = await response.arrayBuffer();
      const buffer = await context.decodeAudioData(data);
      this.buffers.set(key, buffer);
      this.pendingBuffers.delete(key);
      return buffer;
    })().catch(() => {
      this.pendingBuffers.delete(key);
      return null;
    });

    this.pendingBuffers.set(key, request);
    return request;
  }

  private async playBuffer(key: string, volume: number): Promise<void> {
    const context = await this.getContext();
    const buffer = await this.loadBuffer(key);
    if (!context || !buffer || !this.enabled) {
      return;
    }

    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = Math.max(0, Math.min(1, volume));
    source.connect(gain);
    gain.connect(context.destination);
    source.start();
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
