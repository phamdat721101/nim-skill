import { describe, it, expect, vi } from 'vitest';
import { verifyOrHeal, defaultCommandRunner } from '../src/enforcer/output-enforcer.js';
import type { EnforceConfig } from '../src/enforcer/output-enforcer.js';
import type { CommandRunner } from '../src/enforcer/output-enforcer.js';

const strict = (strategies: EnforceConfig['strategies'], maxHeals = 3): EnforceConfig => ({
  strategies,
  maxHeals,
  mode: 'strict',
});

const okRunner: CommandRunner = () => ({ ok: true });
const failRunner: CommandRunner = () => ({ ok: false, detail: 'boom' });

describe('verifyOrHeal — strategies', () => {
  it('nonempty: passes on non-empty, fails on empty', async () => {
    expect((await verifyOrHeal({ a: 1 }, strict([{ kind: 'nonempty' }]))).verified).toBe(true);
    const r = await verifyOrHeal({}, strict([{ kind: 'nonempty' }]));
    expect(r.verified).toBe(false);
    expect(r.checks[0]?.reason).toMatch(/empty/);
  });

  it('json: fails when output is not serializable', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect((await verifyOrHeal(circular, strict([{ kind: 'json' }]))).verified).toBe(false);
  });

  it('schema: fails when required fields missing, passes when present', async () => {
    const cfg = strict([{ kind: 'schema', required: ['id', 'user.name'] }]);
    expect((await verifyOrHeal({ id: 1, user: { name: 'x' } }, cfg)).verified).toBe(true);
    const r = await verifyOrHeal({ id: 1 }, cfg);
    expect(r.verified).toBe(false);
    expect(r.checks[0]?.reason).toMatch(/user\.name/);
  });

  it('math(invoice-sum): passes when items sum to total, fails otherwise', async () => {
    const cfg = strict([{ kind: 'math', check: 'invoice-sum', itemsField: 'items', totalField: 'total' }]);
    expect((await verifyOrHeal({ items: [{ amount: 2 }, { amount: 3 }], total: 5 }, cfg)).verified).toBe(true);
    expect((await verifyOrHeal({ items: [{ amount: 2 }], total: 5 }, cfg)).verified).toBe(false);
  });

  it('command/test/lint: use the injected runner', async () => {
    expect((await verifyOrHeal({ a: 1 }, strict([{ kind: 'test', command: 'x' }]), { runner: okRunner })).verified).toBe(true);
    const r = await verifyOrHeal({ a: 1 }, strict([{ kind: 'command', command: 'x' }]), { runner: failRunner });
    expect(r.verified).toBe(false);
    expect(r.checks[0]?.reason).toBe('boom');
  });

  it('command strategy without a command fails with a clear reason', async () => {
    // @ts-expect-error deliberately missing command
    const r = await verifyOrHeal({ a: 1 }, strict([{ kind: 'command' }]));
    expect(r.verified).toBe(false);
    expect(r.checks[0]?.reason).toMatch(/requires a 'command'/);
  });
});

describe('verifyOrHeal — self-heal loop', () => {
  it('self-heals then verifies within budget', async () => {
    let call = 0;
    const reExecute = vi.fn(() => {
      call += 1;
      return call >= 2 ? { id: 'fixed' } : {};
    });
    const r = await verifyOrHeal({}, strict([{ kind: 'schema', required: ['id'] }], 3), { reExecute });
    expect(r.verified).toBe(true);
    expect(r.heals).toBe(2);
    expect(reExecute).toHaveBeenCalledTimes(2);
  });

  it('stops at maxHeals and returns unverified', async () => {
    const reExecute = vi.fn(() => ({})); // never fixes
    const r = await verifyOrHeal({}, strict([{ kind: 'schema', required: ['id'] }], 2), { reExecute });
    expect(r.verified).toBe(false);
    expect(r.heals).toBe(2);
    expect(reExecute).toHaveBeenCalledTimes(2);
  });

  it('feedback string is passed to reExecute', async () => {
    const reExecute = vi.fn((fb: string) => ({ id: fb.includes('missing') ? 'ok' : undefined }));
    await verifyOrHeal({}, strict([{ kind: 'schema', required: ['id'] }], 1), { reExecute });
    expect(reExecute).toHaveBeenCalledWith(expect.stringMatching(/rejected the previous result/));
  });
});

describe('verifyOrHeal — modes', () => {
  it('warn: records failures but verifies true and calls onWarn', async () => {
    const onWarn = vi.fn();
    const r = await verifyOrHeal({}, { strategies: [{ kind: 'nonempty' }], maxHeals: 3, mode: 'warn' }, { onWarn });
    expect(r.verified).toBe(true);
    expect(r.checks[0]?.pass).toBe(false);
    expect(onWarn).toHaveBeenCalledOnce();
  });

  it('off: returns verified without running checks', async () => {
    const r = await verifyOrHeal({}, { strategies: [{ kind: 'nonempty' }], maxHeals: 3, mode: 'off' });
    expect(r.verified).toBe(true);
    expect(r.checks).toHaveLength(0);
  });
});

describe('defaultCommandRunner', () => {
  it('passes for a true command, fails for a false command', () => {
    expect(defaultCommandRunner('exit 0').ok).toBe(true);
    expect(defaultCommandRunner('exit 1').ok).toBe(false);
  });
});
