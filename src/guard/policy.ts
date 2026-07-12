/**
 * src/guard/policy.ts
 * -------------------
 * Policy enforcement primitives: cumulative cost cap, sliding-window rate
 * limit, and tool allowlist. In-memory state is bounded (size caps +
 * evict-oldest) so a long-lived process can never grow unbounded — ported from
 * the seed's CostTracker / rate limiter discipline.
 *
 * Pure decision logic (returns a reason string or null). Throwing is the
 * guard's job — this file stays side-effect-free and trivially testable.
 */

const MAX_TRACKED_AGENTS = 10_000;

interface Window {
  windowStart: number;
  value: number;
}

function evictOldest(map: Map<string, Window>): void {
  let oldestKey: string | undefined;
  let oldest = Infinity;
  for (const [k, v] of map) {
    if (v.windowStart < oldest) {
      oldest = v.windowStart;
      oldestKey = k;
    }
  }
  if (oldestKey !== undefined) map.delete(oldestKey);
}

export interface PolicyLimits {
  maxCostUsd: number;
  ratePerMin: number;
  allowTools: string[];
}

/** Holds bounded per-agent counters. One instance per guard (no globals). */
export class PolicyEnforcer {
  private cost = new Map<string, Window>();
  private rate = new Map<string, Window>();
  private readonly allowAll: boolean;
  private readonly allow: Set<string>;

  constructor(private readonly limits: PolicyLimits, private readonly now: () => number = Date.now) {
    this.allow = new Set(limits.allowTools);
    this.allowAll = this.allow.has('*');
  }

  /** Returns a deny reason, or null when the call is allowed. */
  check(agentId: string, tool?: string, costUsd = 0): string | null {
    if (!this.allowAll && tool !== undefined && !this.allow.has(tool)) {
      return `tool_not_allowed: '${tool}'`;
    }
    if (this.exceedsRate(agentId)) return 'rate_limited';
    if (this.exceedsCost(agentId, costUsd)) return 'cost_cap_exceeded';
    return null;
  }

  private exceedsRate(agentId: string): boolean {
    const now = this.now();
    let w = this.rate.get(agentId);
    if (!w || now - w.windowStart > 60_000) {
      w = { windowStart: now, value: 0 };
      this.rate.set(agentId, w);
    }
    if (this.rate.size > MAX_TRACKED_AGENTS) evictOldest(this.rate);
    w.value += 1;
    return w.value > this.limits.ratePerMin;
  }

  private exceedsCost(agentId: string, costUsd: number): boolean {
    if (!Number.isFinite(this.limits.maxCostUsd)) return false;
    const now = this.now();
    let w = this.cost.get(agentId);
    if (!w) {
      w = { windowStart: now, value: 0 };
      this.cost.set(agentId, w);
    }
    if (this.cost.size > MAX_TRACKED_AGENTS) evictOldest(this.cost);
    const projected = w.value + costUsd;
    if (projected > this.limits.maxCostUsd) return true;
    w.value = projected;
    return false;
  }
}
