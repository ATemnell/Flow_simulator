import { useEffect } from 'react';
import { useRun } from './runStore';

/** Drives the simulation with requestAnimationFrame while playing. */
export function useRunLoop() {
  const playing = useRun((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      // Cap the frame delta so a backgrounded tab doesn't jump far ahead.
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      useRun.getState().tick(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}
