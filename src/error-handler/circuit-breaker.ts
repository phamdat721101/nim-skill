/**
 * src/error-handler/circuit-breaker.ts
 * ------------------------------------
 * Sliding-window circuit breaker. Opens when failures in the recent window
 * reach `failN`; stays open for `cooldownMs`, then half-opens (one probe).
 * Ported from HyperMove `sentinel.ts`, keyed by an arbitrary string (skill).
 * Bounded per-key state; injectable clock for deterministic tests.
 */

interface BreakerState {
  outcomes: boolean[]; // true = success
  cursor: number;
  openedAt: number | null;
}

export class CircuitBreaker {
  private state = new Map<string, BreakerState>();

  constructor(
    private readonly failN: number,
    private readonly cooldownMs: number,
    private readonly windowSize: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when the breaker for `key` is currently open (deny). */
  isOpen(key: string): boolean {
    const s = this.state.get(key);
    if (!s || s.openedAt === null) return false;
    if (this.now() - s.openedAt < this.cooldownMs) return true;
    // Cool-down elapsed → half-open: reset and allow the next probe.
    s.openedAt = null;
    s.outcomes = [];
    s.cursor = 0;
    return false;
  }

  record(key: string, success: boolean): void {
    let s = this.state.get(key);
    if (!s) {
      s = { outcomes: [], cursor: 0, openedAt: null };
      this.state.set(key, s);
    }
    if (s.outcomes.length < this.windowSize) s.outcomes.push(success);
    else {
      s.outcomes[s.cursor] = success;
      s.cursor = (s.cursor + 1) % this.windowSize;
    }
    const fails = s.outcomes.filter((o) => !o).length;
    if (fails >= this.failN) s.openedAt = this.now();
  }
}
