import bomberFlybyUrl from "../assets/audio/bomber_flyby.mp3";
import defeatUrl from "../assets/audio/defeat.mp3";
import explodeUrl from "../assets/audio/explode.mp3";
import stormWarnUrl from "../assets/audio/storm_warn.mp3";
import stormWaveUrl from "../assets/audio/storm_wave.mp3";
import themeUrl from "../assets/audio/theme.mp3";
import victoryUrl from "../assets/audio/victory.mp3";
import waterMissUrl from "../assets/audio/water_miss.mp3";
import whizzHitUrl from "../assets/audio/whizz_hit.mp3";

export type AssetKind = "audio" | "texture" | "sprite";

export interface AssetEntry {
  key: string;
  kind: AssetKind;
  path: string;
  description: string;
}
export const assetManifest: AssetEntry[] = [
  { key: "flyby", kind: "audio", path: bomberFlybyUrl, description: "Bomber plane flyby" },
  { key: "hit", kind: "audio", path: explodeUrl, description: "Successful ship hit explosion" },
  { key: "whizz-hit", kind: "audio", path: whizzHitUrl, description: "Projectile whizz on successful hit" },
  { key: "miss", kind: "audio", path: waterMissUrl, description: "Water splash miss" },
  { key: "theme", kind: "audio", path: themeUrl, description: "Optional battle theme music" },
  { key: "victory", kind: "audio", path: victoryUrl, description: "Victory sting" },
  { key: "defeat", kind: "audio", path: defeatUrl, description: "Defeat sting" },
  { key: "storm-warn", kind: "audio", path: stormWarnUrl, description: "Storm warning cue" },
  { key: "storm-wave", kind: "audio", path: stormWaveUrl, description: "Storm wave cue" },
  { key: "water", kind: "texture", path: "/assets/textures/water.png", description: "Board water texture" },
  { key: "ship", kind: "texture", path: "/assets/textures/ship.png", description: "Ship hull texture" },
  { key: "marker-hit", kind: "sprite", path: "/assets/sprites/hit.png", description: "Hit marker sprite" },
  { key: "marker-miss", kind: "sprite", path: "/assets/sprites/miss.png", description: "Miss marker sprite" }
];

export class AssetManager {
  private readonly cache = new Map<string, HTMLImageElement>();

  get(key: string): HTMLImageElement | undefined {
    return this.cache.get(key);
  }

  getPath(key: string): string | undefined {
    return assetManifest.find((entry) => entry.key === key)?.path;
  }

  preload(entries = assetManifest): void {
    for (const entry of entries) {
      if (entry.kind === "audio" || this.cache.has(entry.key)) {
        continue;
      }
      const element = new Image();
      element.src = entry.path;
      this.cache.set(entry.key, element);
    }
  }
}

export const assets = new AssetManager();
