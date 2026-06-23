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

/** Emit a progress update at most every `interval` ticks. */
export function shouldEmit(counter: number, interval = 100): boolean {
  return counter % interval === 0;
}
