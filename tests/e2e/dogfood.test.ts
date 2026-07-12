import { describe, it, expect, afterEach } from 'vitest';
import { rmSync, readFileSync } from 'node:fs';
import { runHarnessed } from '../../src/harness/runtime.js';
import { parseTraces, summarize } from '../../src/monitor/dashboard.js';
import type { SkillDef, SkillContext, HarnessConfig } from '../../src/harness/types.js';

const TRACE = '.nim-e2e/traces.jsonl';
const ctx: SkillContext = { agentId: 'e2e' };
const monitorToFile: HarnessConfig['monitor'] = { exporters: ['file'], traceFile: TRACE };
const flush = () => new Promise((r) => setTimeout(r, 10));

afterEach(() => rmSync('.nim-e2e', { recursive: true, force: true }));

describe('dogfood e2e', () => {
  it('captures a transient recovery AND a blocked-bad-output in the trace file', async () => {
    // 1) A skill that fails transiently once, then succeeds → error-class recovery.
    let n = 0;
    const recovering: SkillDef = {
      name: 'recovering',
      version: '0.0.0',
      harness: { errorHandler: { retries: 3, backoff: 'none' }, monitor: monitorToFile },
      execute: () => {
        n += 1;
        if (n < 2) throw new Error('ETIMEDOUT contacting upstream');
        return { ok: true };
      },
    };
    const rec = await runHarnessed(recovering, {}, ctx);
    expect(rec.output).toEqual({ ok: true });
    expect(n).toBe(2); // proves the transient was retried and recovered

    // 2) A skill whose output fails verification and cannot self-heal → blocked.
    const blocked: SkillDef = {
      name: 'blocked',
      version: '0.0.0',
      harness: {
        enforcer: { strategies: [{ kind: 'schema', required: ['invoiceId'] }], maxHeals: 1 },
        monitor: monitorToFile,
      },
      execute: () => ({ wrong: 'field' }),
    };
    const blk = await runHarnessed(blocked, {}, ctx);
    expect(blk.verified).toBe(false); // blocked-bad-output

    await flush();

    // 3) Both runs are in the JSONL trace file; the dashboard summarizes them.
    const traces = parseTraces(readFileSync(TRACE, 'utf8'));
    const bySkill = Object.fromEntries(traces.map((t) => [t.skill, t]));
    expect(bySkill.recovering?.status).toBe('success');
    expect(bySkill.blocked?.verifyPassed).toBe(false);

    const dash = summarize(traces);
    expect(dash).toMatch(/run/);
    expect(dash).toMatch(/verify:/);
  });
});
