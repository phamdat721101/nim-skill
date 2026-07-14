#!/usr/bin/env node
/**
 * src/cli.ts — nim-skill CLI.
 *   run "<cmd>"      run a shell command INSIDE the harness (nim.json-driven)
 *   enforce "<cmd>"  standalone verify-gate: block unless the command passes
 *   monitor          render the local trace dashboard
 *   add <primitive>  install a primitive's SKILL.md into a host skills dir
 */
import { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { VERSION } from './index.js';
import { loadNimJson, mergeHarness, resolveConfig } from './config.js';
import { runHarnessed, HarnessExecutionError } from './harness/runtime.js';
import { verifyOrHeal } from './enforcer/output-enforcer.js';
import { renderDashboard } from './monitor/dashboard.js';
import { GuardError } from './guard/guard.js';
import { PRIMITIVES, UMBRELLA, HOST_DIRS, resolveTargetDirs, expandTargets, sourceOf, installSkill } from './install.js';
import type { HarnessConfig, SkillDef } from './harness/types.js';

function runShell(cmd: string): { code: number; stdout: string; stderr: string } {
  const r = spawnSync(cmd, { shell: true, encoding: 'utf8' });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const program = new Command();
program
  .name('nim-skill')
  .description('Local-first agent-harness toolkit: runHarnessed() + reliability primitives.')
  .version(VERSION);

program
  .command('run')
  .argument('<cmd>', 'shell command to run inside the harness')
  .option('--enforce', 'require a non-empty, non-error result (adds a nonempty check)')
  .option('--monitor', 'force console + file trace exporters')
  .description('Run a command inside the harness (guard/error-handler/monitor/enforcer via nim.json).')
  .action(async (cmd: string, opts: { enforce?: boolean; monitor?: boolean }) => {
    let harness: HarnessConfig = loadNimJson();
    if (opts.monitor) harness = mergeHarness(harness, { monitor: { exporters: ['console', 'file'] } });
    if (opts.enforce) harness = mergeHarness(harness, { enforcer: { strategies: [{ kind: 'schema', required: ['stdout'] }], mode: 'strict', maxHeals: 0 } });

    const skill: SkillDef = {
      name: 'cli.run',
      version: VERSION,
      harness,
      execute: () => {
        const res = runShell(cmd);
        if (res.code !== 0) throw new Error(`command exited ${res.code}: ${res.stderr.trim()}`);
        return { stdout: res.stdout.trim(), code: res.code };
      },
    };

    try {
      const r = await runHarnessed(skill, {}, { agentId: 'cli' });
      process.stdout.write((r.output.stdout as string) ?? '');
      process.stdout.write('\n');
      if (!r.verified) {
        process.stderr.write('nim: output failed verification\n');
        process.exitCode = 1;
      }
    } catch (err) {
      if (err instanceof GuardError) process.stderr.write(`nim: blocked by guard (${err.reason})\n`);
      else if (err instanceof HarnessExecutionError) process.stderr.write(`nim: ${err.message}\n`);
      else process.stderr.write(`nim: ${(err as Error).message}\n`);
      process.exitCode = 1;
    }
  });

program
  .command('enforce')
  .argument('<cmd>', 'verify command; nonzero exit blocks')
  .description('Standalone verify-gate: block unless the command passes (like an unbypassable pre-commit hook).')
  .action(async (cmd: string) => {
    const vr = await verifyOrHeal({ cmd }, { strategies: [{ kind: 'command', command: cmd }], maxHeals: 0, mode: 'strict' });
    if (vr.verified) {
      process.stdout.write(`nim: verify passed (${cmd})\n`);
    } else {
      process.stderr.write(`nim: verify FAILED — not shipping. ${vr.checks.map((c) => c.reason).filter(Boolean).join('; ')}\n`);
      process.exitCode = 1;
    }
  });

program
  .command('monitor')
  .argument('[action]', 'dashboard', 'dashboard')
  .option('--file <path>', 'trace file', '.nim/traces.jsonl')
  .option('--savings', 'show the U3 net-token savings view')
  .option('--cache', 'show the v0.3 cache-ROI view')
  .description('Render the local run dashboard from the JSONL trace file.')
  .action((_action: string, opts: { file: string; savings?: boolean; cache?: boolean }) => {
    const view = opts.savings ? 'savings' : opts.cache ? 'cache' : 'default';
    process.stdout.write(renderDashboard(opts.file, view) + '\n');
  });

function performInstall(targets: string[], opts: { host?: string; dir?: string; lean?: boolean }): void {
  const dirs = resolveTargetDirs(opts.host, opts.dir);
  if (!dirs) {
    process.stderr.write(`nim: unknown host '${opts.host}'. Options: ${Object.keys(HOST_DIRS).join(', ')} (or use --dir)\n`);
    process.exitCode = 1;
    return;
  }
  const { names, unknown } = expandTargets(targets);
  if (unknown.length) {
    process.stderr.write(`nim: unknown target(s): ${unknown.join(', ')}. Options: ${[...PRIMITIVES, UMBRELLA].join(', ')} | all\n`);
    process.exitCode = 1;
    return;
  }
  for (const dir of dirs) {
    for (const name of names) {
      if (!existsSync(sourceOf(name))) {
        process.stderr.write(`nim: skill source not found at ${sourceOf(name)}\n`);
        process.exitCode = 1;
        return;
      }
      process.stdout.write(`nim: installed ${name} → ${installSkill(name, dir, undefined, opts.lean)}\n`);
    }
  }
}

program
  .command('add')
  .argument('[targets...]', `skills to install (default: all): ${PRIMITIVES.join(', ')} | all | nim-skill`)
  .option('--host <host>', 'target host: claude | kiro | cursor')
  .option('--dir <path>', 'explicit host skills directory (overrides --host)')
  .option('--lean', 'install lean manifests (omit reference sections) for hosts without progressive disclosure')
  .description('Install skill manifests into a host skills directory so any agent can discover them.')
  .action((targets: string[], opts: { host?: string; dir?: string; lean?: boolean }) => performInstall(targets, opts));

program
  .command('install')
  .option('--host <host>', 'target host: claude | kiro | cursor')
  .option('--dir <path>', 'explicit host skills directory (overrides --host)')
  .option('--lean', 'install lean manifests (omit reference sections)')
  .description('Install ALL nim-skill skills into detected agent hosts (zero-config alias of `add all`).')
  .action((opts: { host?: string; dir?: string; lean?: boolean }) => performInstall([], opts));

program.parseAsync(process.argv);

export { resolveConfig };
