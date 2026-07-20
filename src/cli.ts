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
import { loadNimJson, mergeHarness, resolveConfig, loadBaselineJson, resolveBaselineConfig, loadWorkspaceJson, resolveWorkspaceConfig, loadWorkruleJson, resolveWorkruleConfig } from './config.js';
import { runHarnessed, HarnessExecutionError } from './harness/runtime.js';
import { verifyOrHeal } from './enforcer/output-enforcer.js';
import { renderDashboard } from './monitor/dashboard.js';
import { GuardError } from './guard/guard.js';
import { PRIMITIVES, UMBRELLA, HOST_DIRS, resolveTargetDirs, expandTargets, sourceOf, installSkill } from './install.js';
import { createBaselineLinter } from './baseline/index.js';
import { createWorkspaceGuard } from './workspace/index.js';
import { createIndexMeter } from './index-meter/index.js';
import { createLessonsHelper } from './lessons/index.js';
import { createLessonsStore } from './lessons/store.js';
import { createWorkruleHelper, WORKRULE_QUESTIONS } from './workrule/index.js';
import { readHookInputFromStdin } from './hook-adapters/stdin-read.js';
import { toClaudeCodeDecision } from './hook-adapters/claude-code.js';
import { toKiroCliDecision } from './hook-adapters/kiro-cli.js';
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

const workspaceCmd = program.command('workspace').description('Hook-native existence + identity + subject-matter + staleness gate for a proposed Write/Edit.');

workspaceCmd
  .command('check')
  .argument('<path>', 'proposed file to check (reads its current on-disk content)')
  .option('--json', 'emit the raw WorkspaceCheckResult as JSON')
  .description('One-shot check against a proposed file (for scripting/CI). Prints the recommendation.')
  .action((path: string, opts: { json?: boolean }) => {
    if (!existsSync(path)) {
      process.stderr.write(`nim: no file found at ${path}\n`);
      process.exitCode = 1;
      return;
    }
    const cfg = resolveWorkspaceConfig(loadWorkspaceJson());
    const guard = createWorkspaceGuard(cfg);
    const result = guard.check({ filePath: path, content: readFileSync(path, 'utf8') });
    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      process.stdout.write(`${result.recommendation}: ${result.reason}\n`);
      if (result.staleWarning) process.stdout.write(`nim: ${result.staleWarning}\n`);
    }
    if (cfg.mode === 'strict' && result.recommendation === 'BLOCK') process.exitCode = 1;
  });

workspaceCmd
  .command('audit')
  .argument('[dir]', 'directory to scan for existence-overlap pairs', '.')
  .description('Scan a directory for existing existence-overlap pairs among its own SKILL.md-declared artifacts.')
  .action((dir: string) => {
    const cfg = resolveWorkspaceConfig(loadWorkspaceJson());
    const guard = createWorkspaceGuard(cfg);
    const pairs = guard.audit(dir);
    if (pairs.length === 0) {
      process.stdout.write('nim: no existence-overlap pairs found\n');
      return;
    }
    for (const p of pairs) process.stdout.write(`${p.pathA} <-> ${p.pathB}: ${p.overlapPct}% overlap\n`);
  });

workspaceCmd
  .command('hook')
  .requiredOption('--format <format>', 'output shape: claude-code | kiro-cli')
  .option('--stdin', 'read a PreToolUse-shaped JSON payload from stdin (tool_name/tool_input.file_path/tool_input.content)')
  .description('Run createWorkspaceGuard().check() against a PreToolUse tool-call payload and emit a ready-to-paste hook decision. --format selects the exact output shape for each CLI host.')
  .action(async (opts: { format: string; stdin?: boolean }) => {
    if (opts.format !== 'claude-code' && opts.format !== 'kiro-cli') {
      process.stderr.write(`nim: unknown --format '${opts.format}'. Options: claude-code, kiro-cli\n`);
      process.exitCode = 1;
      return;
    }
    if (!opts.stdin) {
      process.stderr.write('nim: workspace hook requires --stdin (no other input source is wired yet)\n');
      process.exitCode = 1;
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = await readHookInputFromStdin();
    } catch (err) {
      const msg = (err as Error).message;
      process.stderr.write(`${msg.startsWith('nim:') ? msg : `nim: invalid input on stdin: ${msg}`}\n`);
      process.exitCode = 1;
      return;
    }
    const toolInput = (payload.tool_input ?? {}) as { file_path?: string; content?: string };
    const filePath = toolInput.file_path ?? '';
    const content = toolInput.content ?? '';

    const cfg = resolveWorkspaceConfig(loadWorkspaceJson());
    const guard = createWorkspaceGuard(cfg);
    const result = guard.check({ filePath, content });

    if (opts.format === 'claude-code') {
      process.stdout.write(JSON.stringify(toClaudeCodeDecision(result, cfg.mode)) + '\n');
      return;
    }
    const decision = toKiroCliDecision(result, cfg.mode);
    if (decision.stdout) process.stdout.write(decision.stdout);
    if (decision.stderr) process.stderr.write(decision.stderr);
    process.exitCode = decision.exitCode;
  });

const lessonsCmd = program.command('lessons').description('Auto-captured, queryable error/lesson log — a similarly-shaped-action-previously-failed check, deterministic (glob + literal-equality), not semantic.');

lessonsCmd
  .command('capture')
  .requiredOption('--tool-name <name>', 'tool name this lesson\'s trigger shape matches, e.g. Write')
  .requiredOption('--path-glob <glob>', 'glob the trigger shape matches against a candidate path')
  .option('--content-signal <signal>', 'optional content-signal label, e.g. off-stack-cluster')
  .requiredOption('--what <text>', 'what went wrong')
  .requiredOption('--fix <text>', 'the correct pattern going forward')
  .option('--severity <severity>', 'info | warning | critical', 'warning')
  .option('--source <source>', 'manual | auto', 'manual')
  .description('Append a new lesson to the local JSONL store.')
  .action((opts: { toolName: string; pathGlob: string; contentSignal?: string; what: string; fix: string; severity: string; source: string }) => {
    const cfg = resolveConfig(loadNimJson()).lessons ?? { store: '.nim/lessons.jsonl', ttlMs: 90 * 24 * 60 * 60 * 1000 };
    const helper = createLessonsHelper(cfg);
    const lesson = helper.capture({
      triggerShape: { toolName: opts.toolName, pathGlob: opts.pathGlob, contentSignal: opts.contentSignal ?? null },
      whatWentWrong: opts.what,
      correctPattern: opts.fix,
      severity: opts.severity as 'info' | 'warning' | 'critical',
      source: opts.source as 'manual' | 'auto',
    });
    process.stdout.write(`nim: captured lesson ${lesson.id}\n`);
  });

lessonsCmd
  .command('check')
  .requiredOption('--tool-name <name>', 'tool name of the candidate action, e.g. Write')
  .requiredOption('--path <path>', 'candidate path to check against logged trigger shapes')
  .option('--content-signal <signal>', 'optional content-signal label to match against')
  .description('Check whether a candidate action matches any logged lesson\'s trigger shape.')
  .action((opts: { toolName: string; path: string; contentSignal?: string }) => {
    const cfg = resolveConfig(loadNimJson()).lessons ?? { store: '.nim/lessons.jsonl', ttlMs: 90 * 24 * 60 * 60 * 1000 };
    const helper = createLessonsHelper(cfg);
    const matches = helper.check({ toolName: opts.toolName, pathGlob: opts.path, contentSignal: opts.contentSignal ?? null });
    if (matches.length === 0) {
      process.stdout.write('nim: no matching lessons\n');
      return;
    }
    for (const m of matches) process.stdout.write(`[${m.severity}] ${m.id}: ${m.whatWentWrong} — ${m.correctPattern}\n`);
  });

lessonsCmd
  .command('list')
  .description('List every non-expired lesson in the local JSONL store.')
  .action(() => {
    const cfg = resolveConfig(loadNimJson()).lessons ?? { store: '.nim/lessons.jsonl', ttlMs: 90 * 24 * 60 * 60 * 1000 };
    const store = createLessonsStore(cfg);
    const all = store.readAll();
    if (all.length === 0) {
      process.stdout.write('nim: no lessons logged\n');
      return;
    }
    for (const l of all) process.stdout.write(`[${l.severity}] ${l.id} (${l.source}, ${l.capturedAt}): ${l.whatWentWrong}\n`);
  });


const workruleCmd = program.command('workrule').description('The six-rule working checklist an agent self-checks against its OWN editing behavior (clean/SOLID, no repeated mistakes, essential files, partial reads, deployability, tracked memory).');

workruleCmd
  .command('check')
  .description('Print the six-question self-check checklist (no LLM call — a self-check prompt, not an automated linter).')
  .action(() => {
    for (const q of WORKRULE_QUESTIONS) process.stdout.write(`[${q.id}] ${q.question}\n`);
  });

workruleCmd
  .command('log')
  .requiredOption('--primitive <name>', 'which nim-skill primitive fired, e.g. nim-cache')
  .requiredOption('--effect <text>', 'what it caught / prevented / enabled this task')
  .option('--tokens-saved <n>', 'measured token/context saving, if known')
  .description('Append a tracked-memory entry (WR-06) to .nim/agent-support-log.md (gitignored).')
  .action((opts: { primitive: string; effect: string; tokensSaved?: string }) => {
    const cfg = resolveWorkruleConfig(loadWorkruleJson());
    const helper = createWorkruleHelper(cfg);
    const tokensSaved = opts.tokensSaved !== undefined ? Number(opts.tokensSaved) : undefined;
    const entry = helper.log({ primitive: opts.primitive, effect: opts.effect, ...(tokensSaved !== undefined && !Number.isNaN(tokensSaved) ? { tokensSaved } : {}) });
    process.stdout.write(`nim: logged (${entry.primitive} @ ${entry.at})\n`);
  });

workruleCmd
  .command('history')
  .description('Print every tracked-memory entry logged so far this project.')
  .action(() => {
    const cfg = resolveWorkruleConfig(loadWorkruleJson());
    const helper = createWorkruleHelper(cfg);
    const all = helper.history();
    if (all.length === 0) {
      process.stdout.write('nim: no agent-support entries logged yet\n');
      return;
    }
    for (const e of all) process.stdout.write(`${e.at}  [${e.primitive}]  ${e.effect}${e.tokensSaved !== undefined ? `  (~${e.tokensSaved} tokens saved)` : ''}\n`);
  });

program.parseAsync(process.argv);

export { resolveConfig };
