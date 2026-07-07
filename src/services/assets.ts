export type AssetKind = "audio" | "texture" | "sprite";

export interface AssetEntry {
  key: string;
  kind: AssetKind;
  path: string;
  description: string;
}

export const assetManifest: AssetEntry[] = [
  { key: "shot", kind: "audio", path: "/assets/audio/shot.mp3", description: "Shot launch sound" },
  { key: "hit", kind: "audio", path: "/assets/audio/hit.mp3", description: "Explosion or impact sound" },
  { key: "miss", kind: "audio", path: "/assets/audio/miss.mp3", description: "Water splash sound" },
  { key: "victory", kind: "audio", path: "/assets/audio/victory.mp3", description: "Victory sting" },
  { key: "water", kind: "texture", path: "/assets/textures/water.png", description: "Board water texture" },
  { key: "ship", kind: "texture", path: "/assets/textures/ship.png", description: "Ship hull texture" },
  { key: "marker-hit", kind: "sprite", path: "/assets/sprites/hit.png", description: "Hit marker sprite" },
  { key: "marker-miss", kind: "sprite", path: "/assets/sprites/miss.png", description: "Miss marker sprite" }
];

export class AssetManager {
  private readonly cache = new Map<string, HTMLImageElement | HTMLAudioElement>();

  get(key: string): HTMLImageElement | HTMLAudioElement | undefined {
    return this.cache.get(key);
  }

  preload(entries = assetManifest): void {
    for (const entry of entries) {
      if (this.cache.has(entry.key)) {
        continue;
      }
      const element = entry.kind === "audio" ? new Audio(entry.path) : new Image();
      if (entry.kind !== "audio") {
        (element as HTMLImageElement).src = entry.path;
      }
      this.cache.set(entry.key, element);
    }
  }
}

export const assets = new AssetManager();
