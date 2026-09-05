import { describe, it, expect, vi, afterEach } from 'vitest';
import { createProgressThrottle, yieldToEventLoop } from './progressUtils';

describe('createProgressThrottle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('suppresses updates inside the interval and allows one once it elapses', () => {
    vi.useFakeTimers();
    const shouldEmit = createProgressThrottle(50);

    expect(shouldEmit()).toBe(false);
    vi.advanceTimersByTime(49);
    expect(shouldEmit()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(shouldEmit()).toBe(true);
    // Passing restarts the interval rather than opening a window.
    expect(shouldEmit()).toBe(false);
  });

  it('does not let the number of calls drive the number of updates', () => {
    vi.useFakeTimers();
    const shouldEmit = createProgressThrottle(50);

    // This is the property the record-count throttle failed: a file with a
    // million records must not cost a million updates (and a million yields).
    let emitted = 0;
    for (let i = 0; i < 1_000_000; i++) {
      if (shouldEmit()) emitted++;
    }
    expect(emitted).toBe(0);

    vi.advanceTimersByTime(50);
    expect(shouldEmit()).toBe(true);
  });

  it('gives each read loop its own interval', () => {
    vi.useFakeTimers();
    const first = createProgressThrottle(50);
    vi.advanceTimersByTime(50);
    expect(first()).toBe(true);

    // A throttle created mid-load starts its interval from scratch, so the
    // caller cannot accidentally inherit an elapsed one.
    const second = createProgressThrottle(50);
    expect(second()).toBe(false);
  });
});

describe('yieldToEventLoop', () => {
  it('resolves after handing control back to the host', async () => {
    let ranInMacrotask = false;
    setTimeout(() => {
      ranInMacrotask = true;
    }, 0);

    await yieldToEventLoop();

    expect(ranInMacrotask).toBe(true);
  });
});
