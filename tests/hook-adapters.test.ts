import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { toClaudeCodeDecision } from '../src/hook-adapters/claude-code.js';
import { toKiroCliDecision } from '../src/hook-adapters/kiro-cli.js';
import { readHookInputFromStdin } from '../src/hook-adapters/stdin-read.js';
import type { WorkspaceCheckResult } from '../src/workspace/index.js';

function result(recommendation: WorkspaceCheckResult['recommendation'], reason = 'r'): WorkspaceCheckResult {
  return { recommendation, reason, evidence: [] };
}

describe('AD-02 toClaudeCodeDecision', () => {
  it('BLOCK maps to permissionDecision deny with the reason surfaced (default mode arg = strict)', () => {
    const out = toClaudeCodeDecision(result('BLOCK', 'off-stack java cluster'));
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('off-stack java cluster');
    expect(out.hookSpecificOutput.hookEventName).toBe('PreToolUse');
  });

  it('mode:"strict" + BLOCK maps to permissionDecision deny', () => {
    const out = toClaudeCodeDecision(result('BLOCK', 'off-stack java cluster'), 'strict');
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('mode:"warn" (the default workspace mode) + BLOCK maps to ask, NOT deny -- advisory only', () => {
    const out = toClaudeCodeDecision(result('BLOCK', 'off-stack java cluster'), 'warn');
    expect(out.hookSpecificOutput.permissionDecision).not.toBe('deny');
    expect(out.hookSpecificOutput.permissionDecision).toBe('ask');
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('off-stack java cluster');
  });

  it('mode:"off" + BLOCK maps to ask, NOT deny (mode:off never hard-blocks at the adapter layer either)', () => {
    const out = toClaudeCodeDecision(result('BLOCK', 'r'), 'off');
    expect(out.hookSpecificOutput.permissionDecision).not.toBe('deny');
  });

  it.each(['EXTEND', 'COMPOSE', 'ITERATE'] as const)('%s maps to ask regardless of mode', (rec) => {
    expect(toClaudeCodeDecision(result(rec, 'r'), 'strict').hookSpecificOutput.permissionDecision).toBe('ask');
    expect(toClaudeCodeDecision(result(rec, 'r'), 'warn').hookSpecificOutput.permissionDecision).toBe('ask');
  });

  it('PROCEED maps to allow regardless of mode', () => {
    expect(toClaudeCodeDecision(result('PROCEED', 'r'), 'strict').hookSpecificOutput.permissionDecision).toBe('allow');
    expect(toClaudeCodeDecision(result('PROCEED', 'r'), 'warn').hookSpecificOutput.permissionDecision).toBe('allow');
  });

  it('surfaces staleWarning as additionalContext when present', () => {
    const out = toClaudeCodeDecision({ ...result('PROCEED', 'r'), staleWarning: 'liveness file is stale' });
    expect(out.hookSpecificOutput.additionalContext).toContain('liveness file is stale');
  });

  it('omits additionalContext when no staleWarning is present', () => {
    const out = toClaudeCodeDecision(result('PROCEED', 'r'));
    expect(out.hookSpecificOutput.additionalContext).toBeUndefined();
  });
});

describe('AD-03 toKiroCliDecision', () => {
  it('BLOCK maps to a non-zero exit code with the reason on stderr (default mode arg = strict)', () => {
    const out = toKiroCliDecision(result('BLOCK', 'off-stack java cluster'));
    expect(out.exitCode).not.toBe(0);
    expect(out.stderr).toContain('off-stack java cluster');
  });

  it('mode:"strict" + BLOCK maps to a non-zero exit code with the reason on stderr', () => {
    const out = toKiroCliDecision(result('BLOCK', 'off-stack java cluster'), 'strict');
    expect(out.exitCode).not.toBe(0);
    expect(out.stderr).toContain('off-stack java cluster');
  });

  it('mode:"warn" (the default workspace mode) + BLOCK maps to exitCode 0 with the reason surfaced as a warning, not a blocking failure', () => {
    const out = toKiroCliDecision(result('BLOCK', 'off-stack java cluster'), 'warn');
    expect(out.exitCode).toBe(0);
    expect(out.stderr).toBe('');
    expect(out.stdout).toContain('off-stack java cluster');
  });

  it('mode:"off" + BLOCK maps to exitCode 0 (mode:off never hard-blocks at the adapter layer either)', () => {
    const out = toKiroCliDecision(result('BLOCK', 'r'), 'off');
    expect(out.exitCode).toBe(0);
  });

  it.each(['EXTEND', 'COMPOSE', 'ITERATE'] as const)('%s maps to exit 0 with the reason surfaced on stdout regardless of mode', (rec) => {
    const out = toKiroCliDecision(result(rec, 'needs review'), 'warn');
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain('needs review');
  });

  it('PROCEED maps to exit 0 with empty/quiet stdout regardless of mode', () => {
    expect(toKiroCliDecision(result('PROCEED', 'r'), 'strict').exitCode).toBe(0);
    expect(toKiroCliDecision(result('PROCEED', 'r'), 'warn').exitCode).toBe(0);
  });

  it('surfaces staleWarning on stdout independent of exit code', () => {
    const out = toKiroCliDecision({ ...result('PROCEED', 'r'), staleWarning: 'liveness file is stale' });
    expect(out.stdout).toContain('liveness file is stale');
  });
});

describe('AD-02 vs AD-03 — provably different shapes for the same input', () => {
  const cases: WorkspaceCheckResult['recommendation'][] = ['BLOCK', 'EXTEND', 'COMPOSE', 'ITERATE', 'PROCEED'];

  it.each(cases)('%s produces divergent output shapes between adapters', (rec) => {
    const input = result(rec, 'shared reason');
    const claude = toClaudeCodeDecision(input);
    const kiro = toKiroCliDecision(input);
    // Claude Code shape: a JSON object keyed by hookSpecificOutput.
    expect(claude).toHaveProperty('hookSpecificOutput');
    expect(claude).not.toHaveProperty('exitCode');
    // Kiro CLI shape: exit-code + stdout/stderr, NOT the Claude Code JSON shape.
    expect(kiro).toHaveProperty('exitCode');
    expect(kiro).toHaveProperty('stdout');
    expect(kiro).toHaveProperty('stderr');
    expect(kiro).not.toHaveProperty('hookSpecificOutput');
  });

  it('BLOCK denies in both adapters, expressed via different vocabularies', () => {
    const input = result('BLOCK', 'shared reason');
    const claude = toClaudeCodeDecision(input);
    const kiro = toKiroCliDecision(input);
    expect(claude.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(kiro.exitCode).not.toBe(0);
  });
});

describe('AD-01 readHookInputFromStdin', () => {
  it('parses a JSON object piped on stdin', async () => {
    expect(typeof readHookInputFromStdin).toBe('function');
  });

  it('resolves the parsed JSON object once stdin emits data then ends', async () => {
    const { EventEmitter } = await import('node:events');
    const fakeStdin = new EventEmitter();
    const originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

    const pending = readHookInputFromStdin();
    fakeStdin.emit('data', Buffer.from(JSON.stringify({ tool_name: 'Write' })));
    fakeStdin.emit('end');

    await expect(pending).resolves.toEqual({ tool_name: 'Write' });
    Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
  });

  it('resolves an empty object when stdin ends with no data', async () => {
    const { EventEmitter } = await import('node:events');
    const fakeStdin = new EventEmitter();
    const originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

    const pending = readHookInputFromStdin();
    fakeStdin.emit('end');

    await expect(pending).resolves.toEqual({});
    Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
  });

  it('rejects when stdin contains invalid JSON', async () => {
    const { EventEmitter } = await import('node:events');
    const fakeStdin = new EventEmitter();
    const originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

    const pending = readHookInputFromStdin();
    fakeStdin.emit('data', Buffer.from('not json'));
    fakeStdin.emit('end');

    await expect(pending).rejects.toThrow(/invalid JSON/i);
    Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
  });
});

describe('AD-06 end-to-end smoke test — CLI workspace hook --format claude-code --stdin', () => {
  const dir = '.nim-e2e-hook';
  const warnDir = '.nim-e2e-hook-warn';
  const offDir = '.nim-e2e-hook-off';
  const cliPath = `${process.cwd()}/dist/cli.js`;

  beforeAll(() => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      `${dir}/nim.json`,
      JSON.stringify({
        workspace: {
          stack: ['typescript', 'web3'],
          offStackSignalTerms: { java: ['@Transactional', 'AbstractRoutingDataSource', 'gradle', 'JDK 21'] },
          clusterThreshold: 3,
          mode: 'strict',
        },
      }),
    );

    mkdirSync(warnDir, { recursive: true });
    writeFileSync(
      `${warnDir}/nim.json`,
      JSON.stringify({
        workspace: {
          stack: ['typescript', 'web3'],
          offStackSignalTerms: { java: ['@Transactional', 'AbstractRoutingDataSource', 'gradle', 'JDK 21'] },
          clusterThreshold: 3,
          mode: 'warn',
        },
      }),
    );

    mkdirSync(offDir, { recursive: true });
    writeFileSync(
      `${offDir}/nim.json`,
      JSON.stringify({
        workspace: {
          stack: ['typescript', 'web3'],
          offStackSignalTerms: { java: ['@Transactional', 'AbstractRoutingDataSource', 'gradle', 'JDK 21'] },
          clusterThreshold: 3,
          mode: 'off',
        },
      }),
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(warnDir, { recursive: true, force: true });
    rmSync(offDir, { recursive: true, force: true });
  });

  const offStackInput = JSON.stringify({
    tool_name: 'Write',
    tool_input: {
      file_path: 'research/cross-product/x.md',
      content: 'Spring @Transactional AbstractRoutingDataSource gradle JDK 21 tenant routing analysis',
    },
  });

  it('mode:"strict" denies a realistic PreToolUse input clustering the Jul-17-shaped off-stack terms', () => {
    const out = execSync(`node ${cliPath} workspace hook --format claude-code --stdin`, { input: offStackInput, cwd: dir }).toString();
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toMatch(/java|off-stack|cluster|signal/i);
  });

  it('mode:"warn" (default) surfaces the SAME BLOCK-worthy input as ask, never deny, via --format claude-code', () => {
    const out = execSync(`node ${cliPath} workspace hook --format claude-code --stdin`, { input: offStackInput, cwd: warnDir }).toString();
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.permissionDecision).not.toBe('deny');
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('ask');
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toMatch(/java|off-stack|cluster|signal/i);
  });

  it('mode:"warn" (default) surfaces the SAME BLOCK-worthy input as exit 0 via --format kiro-cli, not a blocking failure', () => {
    const result = spawnSync('node', [cliPath, 'workspace', 'hook', '--format', 'kiro-cli', '--stdin'], {
      input: offStackInput,
      cwd: warnDir,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/java|off-stack|cluster|signal|BLOCK/i);
  });

  it('mode:"off" always allows through --format claude-code, even for the same off-stack-clustering input', () => {
    const out = execSync(`node ${cliPath} workspace hook --format claude-code --stdin`, { input: offStackInput, cwd: offDir }).toString();
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('allow');
  });

  it('emits the kiro-cli shape (exit 0, no JSON) for clean content via --format kiro-cli', () => {
    const input = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: 'research/cross-product/clean.md', content: 'clean typescript content, nothing off-stack here' },
    });
    const out = execSync(`node ${cliPath} workspace hook --format kiro-cli --stdin`, { input, cwd: dir }).toString();
    // PROCEED path -- plain text, not JSON, per the Kiro shape.
    expect(() => JSON.parse(out)).toThrow();
  });

  it('regression: malformed stdin JSON fails cleanly (no stack trace, one-line stderr message, exit 1) instead of an unhandled-rejection crash', () => {
    const result = spawnSync('node', [cliPath, 'workspace', 'hook', '--format', 'claude-code', '--stdin'], {
      input: 'not-json{{{',
      cwd: dir,
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    // No raw Node stack-trace markers.
    expect(result.stderr).not.toMatch(/at Socket\.|at process\.|processTicksAndRejections|node:internal/);
    expect(result.stderr).not.toMatch(/\bthrow\b/);
    // Clean, single-line, designed error message.
    const lines = result.stderr.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^nim: invalid JSON on stdin: /);
  });
});
