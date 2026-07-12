import { describe, it, expect, vi } from 'vitest';
import { classify, isRetryable } from '../src/error-handler/classify.js';
import { CircuitBreaker } from '../src/error-handler/circuit-breaker.js';
import { run, createBreaker } from '../src/error-handler/recover.js';
import { resolveConfig } from '../src/config.js';

const policy = (over = {}) => resolveConfig({ errorHandler: { ...over } }).errorHandler!;
const noSleep = () => Promise.resolve();

describe('classify', () => {
  it('routes transient / permanent / critical', () => {
    expect(classify(new Error('connection ETIMEDOUT')).class).toBe('transient');
    expect(classify(new Error('429 too many requests')).class).toBe('transient');
    expect(classify(new Error('unauthorized')).class).toBe('critical');
    expect(classify(new Error('bad field value')).class).toBe('permanent');
  });
  it('honors an explicit class hint on the error', () => {
    const e = Object.assign(new Error('x'), { class: 'transient' as const });
    expect(classify(e).class).toBe('transient');
  });
  it('isRetryable only for transient', () => {
    expect(isRetryable('transient')).toBe(true);
    expect(isRetryable('permanent')).toBe(false);
  });
});

describe('run', () => {
  it('returns ok on first success', async () => {
    const r = await run(() => 7, policy(), { sleep: noSleep });
    expect(r).toEqual({ ok: true, value: 7 });
  });

  it('retries transient failures then succeeds', async () => {
    let n = 0;
    const fn = vi.fn(() => {
      n += 1;
      if (n < 3) throw new Error('network timeout');
      return 'done';
    });
    const r = await run(fn, policy({ retries: 3 }), { sleep: noSleep });
    expect(r).toEqual({ ok: true, value: 'done' });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('returns a classified error after exhausting transient retries', async () => {
    const r = await run(() => { throw new Error('ETIMEDOUT'); }, policy({ retries: 2 }), { sleep: noSleep });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.class).toBe('transient');
      expect(r.error.attempts).toBe(3);
    }
  });

  it('does not retry permanent errors', async () => {
    const fn = vi.fn(() => { throw new Error('invalid argument'); });
    const r = await run(fn, policy({ retries: 5 }), { sleep: noSleep });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(false);
  });

  it('escalates critical errors immediately without retry', async () => {
    const onEscalate = vi.fn();
    const fn = vi.fn(() => { throw new Error('unauthorized'); });
    const r = await run(fn, policy({ retries: 5 }), { sleep: noSleep, onEscalate });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onEscalate).toHaveBeenCalledOnce();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.class).toBe('critical');
  });

  it('uses fallback on permanent failure', async () => {
    const r = await run(() => { throw new Error('bad input'); }, policy(), { sleep: noSleep, fallback: () => 'fb' });
    expect(r).toEqual({ ok: true, value: 'fb' });
  });

  it('short-circuits when the breaker is open', async () => {
    let clock = 0;
    const breaker = new CircuitBreaker(2, 1000, 10, () => clock);
    const failing = () => { throw new Error('network timeout'); };
    // Two transient failures open the breaker (retries:0 → one attempt each).
    await run(failing, policy({ retries: 0, circuitBreaker: { failN: 2 } }), { sleep: noSleep, breaker, key: 'k' });
    await run(failing, policy({ retries: 0, circuitBreaker: { failN: 2 } }), { sleep: noSleep, breaker, key: 'k' });
    const probe = vi.fn(() => 'ok');
    const r = await run(probe, policy({ retries: 0 }), { sleep: noSleep, breaker, key: 'k' });
    expect(r.ok).toBe(false); // breaker open → probe never runs
    expect(probe).not.toHaveBeenCalled();
    // After cooldown, half-open allows the probe.
    clock = 2000;
    const r2 = await run(probe, policy({ retries: 0 }), { sleep: noSleep, breaker, key: 'k' });
    expect(r2).toEqual({ ok: true, value: 'ok' });
  });
});

describe('createBreaker', () => {
  it('returns a breaker when configured, undefined when disabled', () => {
    expect(createBreaker(policy())).toBeInstanceOf(CircuitBreaker);
    expect(createBreaker(policy({ circuitBreaker: false }))).toBeUndefined();
  });
});
