/**
 * src/enforcer/output-enforcer.ts
 * -------------------------------
 * The "enforce, don't instruct" verify-gate. Before a skill's output ships,
 * run its declared verify strategies. On failure, if a reExecute is supplied
 * and mode is 'strict', feed the structured failure back and re-execute
 * (bounded by maxHeals). This runs INSIDE the harness runtime, so an agent
 * cannot bypass it — the analog of a pre-commit hook `--no-verify` cannot skip.
 *
 * Ported from HyperMove `harness/output-enforcer.ts` (nonempty/json/schema/math),
 * extended with command-based strategies (test/lint/command) via an injectable
 * CommandRunner, and strict|warn modes. Strategies are data-only (serializable).
 */

import { spawnSync } from 'node:child_process';
import type { VerifyStrategy, CheckResult, VerifyResult, EnforceMode } from '../harness/types.js';

type ReExecute = (feedback: string) => Promise<Record<string, unknown>> | Record<string, unknown>;

/** Runs a verify command. Injectable so tests never touch a real shell. */
export type CommandRunner = (command: string) => { ok: boolean; detail?: string };

/** Default runner: pass iff the command exits 0. Never throws. */
export const defaultCommandRunner: CommandRunner = (command) => {
  const res = spawnSync(command, { shell: true, encoding: 'utf8' });
  if (res.status === 0) return { ok: true };
  const detail = (res.stderr || res.stdout || res.error?.message || `exit ${res.status}`)
    .toString()
    .trim()
    .slice(0, 500);
  return { ok: false, detail };
};

export interface VerifyOptions {
  reExecute?: ReExecute;
  runner?: CommandRunner;
  /** Called with the failing checks when running in 'warn' mode. */
  onWarn?: (checks: CheckResult[]) => void;
}

function get(obj: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined),
      obj,
    );
}

function runStrategy(
  output: Record<string, unknown>,
  s: VerifyStrategy,
  runner: CommandRunner,
): CheckResult {
  switch (s.kind) {
    case 'nonempty': {
      const pass = output != null && Object.keys(output).length > 0;
      return { strategy: 'nonempty', pass, reason: pass ? undefined : 'output is empty' };
    }
    case 'json': {
      try {
        JSON.stringify(output);
        return { strategy: 'json', pass: true };
      } catch {
        return { strategy: 'json', pass: false, reason: 'output is not JSON-serializable' };
      }
    }
    case 'schema': {
      if (!Array.isArray(s.required)) {
        return { strategy: 'schema', pass: false, reason: "schema strategy requires a 'required' string[]" };
      }
      const missing = s.required.filter((f) => get(output, f) === undefined);
      const pass = missing.length === 0;
      return {
        strategy: `schema(${s.required.join(',')})`,
        pass,
        reason: pass ? undefined : `missing required fields: ${missing.join(', ')}`,
      };
    }
    case 'math': {
      const items = get(output, s.itemsField);
      const total = Number(get(output, s.totalField));
      if (!Array.isArray(items) || Number.isNaN(total)) {
        return {
          strategy: 'math(invoice-sum)',
          pass: false,
          reason: `cannot read "${s.itemsField}" (array) and "${s.totalField}" (number)`,
        };
      }
      const sum = items.reduce(
        (acc: number, it) => acc + Number((it as Record<string, unknown>)?.amount ?? 0),
        0,
      );
      const pass = Math.abs(sum - total) < 0.01;
      return {
        strategy: 'math(invoice-sum)',
        pass,
        reason: pass ? undefined : `line-item sum ${sum.toFixed(2)} != total ${total.toFixed(2)}`,
      };
    }
    case 'test':
    case 'lint':
    case 'command': {
      if (!s.command) {
        return { strategy: s.kind, pass: false, reason: `${s.kind} strategy requires a 'command'` };
      }
      const res = runner(s.command);
      return {
        strategy: `${s.kind}(${s.command})`,
        pass: res.ok,
        reason: res.ok ? undefined : res.detail ?? 'command failed',
      };
    }
    default:
      return { strategy: 'unknown', pass: true };
  }
}

export interface EnforceConfig {
  strategies: VerifyStrategy[];
  maxHeals: number;
  mode: EnforceMode;
  /** 'minimal' feeds back a compact structured diff; 'full' (default) the prose reason dump. */
  healFeedback?: 'minimal' | 'full';
}

/** Build self-heal feedback — compact structured (minimal) or prose (full). */
function buildFeedback(failed: CheckResult[], mode: 'minimal' | 'full'): string {
  if (mode === 'minimal') {
    return JSON.stringify({ rejected: failed.map((c) => ({ strategy: c.strategy, reason: c.reason })) });
  }
  return `output-enforcer rejected the previous result: ${failed
    .map((c) => c.reason)
    .filter(Boolean)
    .join('; ')}. Fix and return again.`;
}

/**
 * Verify `output` against `config.strategies`.
 *  - mode 'strict': failing checks block (verified:false); with reExecute,
 *    feed failures back and retry up to maxHeals.
 *  - mode 'warn': record failures + call onWarn, but always verified:true.
 *  - mode 'off': callers disable the enforcer upstream (config resolves null),
 *    so this path returns verified:true without running checks.
 */
export async function verifyOrHeal(
  output: Record<string, unknown>,
  config: EnforceConfig,
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  const runner = opts.runner ?? defaultCommandRunner;
  const maxHeals = Math.min(Math.max(config.maxHeals, 0), 5);
  let current = output;
  let heals = 0;

  if (config.mode === 'off') {
    return { verified: true, heals: 0, checks: [], output: current };
  }

  for (;;) {
    const checks = config.strategies.map((s) => runStrategy(current, s, runner));
    const failed = checks.filter((c) => !c.pass);

    if (failed.length === 0) return { verified: true, heals, checks, output: current };

    if (config.mode === 'warn') {
      opts.onWarn?.(failed);
      return { verified: true, heals, checks, output: current };
    }

    // strict: block, or self-heal if we can and have budget left.
    if (!opts.reExecute || heals >= maxHeals) {
      return { verified: false, heals, checks, output: current };
    }

    const feedback = buildFeedback(failed, config.healFeedback ?? 'full');
    current = await opts.reExecute(feedback);
    heals += 1;
  }
}
