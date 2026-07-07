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

export function rafLoop(onFrame: (deltaMs: number, now: number) => void): () => void {
  let frame = 0;
  let previous = performance.now();
  const tick = (now: number) => {
    const delta = now - previous;
    previous = now;
    onFrame(delta, now);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}
