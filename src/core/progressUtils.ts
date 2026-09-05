/**
 * Yield to the host event loop so React can flush a state update before the
 * next chunk of synchronous parsing work.
 *
 * setTimeout(_, 0) is platform-agnostic; requestAnimationFrame is intentionally
 * avoided because src/core/ must remain runnable outside the browser.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/** ~20 updates per second, which reads as continuous motion in a progress bar. */
const DEFAULT_INTERVAL_MS = 50;

/**
 * Gates progress updates on elapsed wall-clock time.
 *
 * Throttling by record count does not survive large files. A yield costs about
 * 2ms because the host clamps setTimeout, so an "every N records" rule makes the
 * yield bill grow with the file: a 500k-message MCAP spent ~11s of a ~14s load
 * sitting in timers. Gating on time bounds that bill at elapsed/interval no
 * matter how many records the file holds.
 *
 * The returned function is stateful — create one per read loop.
 */
export function createProgressThrottle(intervalMs = DEFAULT_INTERVAL_MS): () => boolean {
  let last = Date.now();
  return () => {
    const now = Date.now();
    if (now - last < intervalMs) return false;
    last = now;
    return true;
  };
}
