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
import { existsSync, readFileSync } from 'node:fs';
import { VERSION } from './index.js';
import { loadNimJson, mergeHarness, resolveConfig, loadBaselineJson, resolveBaselineConfig } from './config.js';
import { runHarnessed, HarnessExecutionError } from './harness/runtime.js';
import { verifyOrHeal } from './enforcer/output-enforcer.js';
import { renderDashboard } from './monitor/dashboard.js';
import { GuardError } from './guard/guard.js';
import { PRIMITIVES, UMBRELLA, HOST_DIRS, resolveTargetDirs, expandTargets, sourceOf, installSkill } from './install.js';
import { createBaselineLinter } from './baseline/index.js';
import { createIndexMeter } from './index-meter/index.js';
import { readMcpConfig, readSkillsDir } from './index-meter/adapters.js';
import { detectTier } from './profile/index.js';
import { tightenFor } from './profile/tiers.js';
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

const baselineCmd = program.command('baseline').description('Lint/scaffold/audit an agent memory file (AGENTS.md/CLAUDE.md-family).');

baselineCmd
  .command('lint')
  .argument('[path]', 'memory file to lint', 'AGENTS.md')
  .option('--strict', 'promote BL-LEN to a blocking failure (exit 1)')
  .description('Lint a memory file against the "would removing this line cause a mistake" rule set. Never auto-edits.')
  .action((path: string, opts: { strict?: boolean }) => {
    const resolvedPath = existsSync(path) ? path : existsSync('CLAUDE.md') ? 'CLAUDE.md' : path;
    if (!existsSync(resolvedPath)) {
      process.stderr.write(`nim: no memory file found at ${resolvedPath}\n`);
      process.exitCode = 1;
      return;
    }
    const cfg = resolveBaselineConfig(loadBaselineJson());
    const linter = createBaselineLinter(cfg);
    const checks = linter.lint(readFileSync(resolvedPath, 'utf8'));
    const findings = checks.filter((c) => !c.pass);
    for (const f of findings) process.stdout.write(`[${f.strategy}] ${f.reason}\n`);
    process.stdout.write(`nim: ${findings.length} findings\n`);
    const blocking = opts.strict ? findings.some((f) => f.strategy === 'BL-LEN') : false;
    if (blocking) process.exitCode = 1;
  });

baselineCmd
  .command('scaffold')
  .argument('[path]', 'output path for the generated memory file', 'AGENTS.md')
  .description('Scaffold a new memory file that starts compliant by construction (a thin index, not a dump).')
  .action(async (path: string) => {
    const { scaffold } = await import('./baseline/scaffold.js');
    const md = scaffold({ projectType: 'project', testCmd: 'npm test', buildCmd: 'npm run build', styleDeviations: [] });
    process.stdout.write(md);
    process.stdout.write(`\nnim: scaffold generated (write it to ${path} yourself to review before saving)\n`);
  });

baselineCmd
  .command('audit')
  .option('--structure', 'check progressive-disclosure structure only (BL-PROGRESSIVE + BL-EMPTYFOLDER)')
  .description('Audit progressive-disclosure structure for the current directory.')
  .action(() => {
    const cfg = resolveBaselineConfig(loadBaselineJson());
    const linter = createBaselineLinter(cfg);
    const checks = linter.audit('.');
    for (const c of checks) process.stdout.write(`[${c.strategy}] ${c.pass ? 'ok' : c.reason}\n`);
  });

const indexCmd = program.command('index').description('Measure the standing MCP/skill tool-disclosure token tax; optionally trim it.');

indexCmd
  .command('measure')
  .option('--mcp-config <path>', 'MCP client config path', '.mcp.json')
  .option('--skills-dir <path>', 'skills directory path', 'skills')
  .option('--turns <n>', 'override estimatedTurnsPerTask', '5')
  .description('Report a token-count + tool-count + cited accuracy-risk band for a project\'s declared tool surface.')
  .action((opts: { mcpConfig: string; skillsDir: string; turns: string }) => {
    const manifest = [...readMcpConfig(opts.mcpConfig), ...readSkillsDir(opts.skillsDir)];
    const meter = createIndexMeter({ estimatedTurnsPerTask: Number(opts.turns), mcpConfigPath: opts.mcpConfig, skillsDir: opts.skillsDir });
    const report = meter.measure(manifest);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  });

indexCmd
  .command('trim')
  .requiredOption('--keep <names>', 'comma-separated tool names to keep')
  .option('--skills-dir <path>', 'skills directory path', 'skills')
  .option('--mcp-config <path>', 'MCP client config path', '.mcp.json')
  .option('--write', 'write the trimmed catalog (never silent — requires this flag)')
  .description('Generate a trimmed, selectively-disclosed catalog. Never writes without --write.')
  .action((opts: { keep: string; skillsDir: string; mcpConfig: string; write?: boolean }) => {
    const manifest = [...readMcpConfig(opts.mcpConfig), ...readSkillsDir(opts.skillsDir)];
    const meter = createIndexMeter({ estimatedTurnsPerTask: 5, mcpConfigPath: opts.mcpConfig, skillsDir: opts.skillsDir });
    const trimmed = meter.trim(manifest, { keep: opts.keep.split(',').map((s) => s.trim()) });
    if (!opts.write) {
      process.stdout.write(JSON.stringify(trimmed, null, 2) + '\n');
      process.stdout.write('nim: preview only — pass --write to persist (never silent)\n');
      return;
    }
    process.stdout.write(JSON.stringify(trimmed, null, 2) + '\n');
  });

const profileCmd = program.command('profile').description('Inspect model-tier detection and per-tier harness config deltas. No run verb — a composition primitive, not a runner.');

profileCmd
  .command('detect')
  .option('--model-hint <hint>', 'model name/base-url hint to classify')
  .option('--tier <tier>', 'explicit tier override')
  .description('Print the tier that WOULD be selected, no side effect.')
  .action((opts: { modelHint?: string; tier?: string }) => {
    const tier = detectTier({ tier: opts.tier as never, modelHint: opts.modelHint });
    process.stdout.write(`${tier}\n`);
  });

profileCmd
  .command('show')
  .requiredOption('--tier <tier>', 'tier to show the resolved config delta for: frontier | open-weight-verified | open-weight-untested')
  .description('Print the resolved config delta for a given tier against a minimal illustrative harness config.')
  .action((opts: { tier: string }) => {
    const sample = { enforcer: { mode: 'warn' as const, maxHeals: 2 }, errorHandler: { circuitBreaker: { failN: 5 } }, guard: { injection: 'off' as const } };
    const delta = tightenFor(opts.tier as never, sample);
    process.stdout.write(JSON.stringify(delta, null, 2) + '\n');
  });

program.parseAsync(process.argv);

export { resolveConfig };
