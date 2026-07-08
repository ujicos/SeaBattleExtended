export type AnimationKind = "hit" | "miss" | "sunk" | "shuffle" | "victory";

export interface TimedAnimation {
  id: string;
  kind: AnimationKind;
  startedAt: number;
  duration: number;
}

export function progress(animation: TimedAnimation, now: number): number {
  return Math.min(1, Math.max(0, (now - animation.startedAt) / animation.duration));
}

export function createAnimation(kind: AnimationKind, duration = 650): TimedAnimation {
  return {
    id: `${kind}-${crypto.randomUUID()}`,
    kind,
    startedAt: performance.now(),
    duration
  };
}
