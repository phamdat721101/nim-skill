import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { proposalHashFor } from '../../src/guard/propose.js';

const cliPath = `${process.cwd()}/dist/cli.js`;
// A dedicated scratch cwd for the guard-gated run test — writing a `guard.propose.require: true`
// nim.json to the SHARED repo root leaks into every other concurrently-running e2e test file that
// also spawns `dist/cli.js` from process.cwd() (found via a real cross-file test failure: it
// silently made tests/e2e/logcompact-cli.test.ts's `run` calls fail with `proposal_required`).
const SCRATCH_DIR = `${process.cwd()}/.nim-propose-scratch`;

beforeAll(() => {
  execSync('npm run build', { cwd: process.cwd(), stdio: 'pipe' });
}, 60_000);

afterEach(() => {
  rmSync('.nim/proposals', { recursive: true, force: true });
  rmSync(SCRATCH_DIR, { recursive: true, force: true });
});

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('node', [cliPath, ...args], { encoding: 'utf8', cwd: process.cwd() });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('nim-skill propose CLI (Task 6 e2e)', () => {
  it('propose scaffolds a plan doc under .nim/proposals', () => {
    const r = run(['propose', 'add a migration']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/wrote proposal/i);
    const id = proposalHashFor('add a migration');
    const path = `.nim/proposals/${id}.md`;
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf8')).toContain('add a migration');
  });

  it('propose --approve <id> marks an existing proposal approved (adds an approved: line)', () => {
    run(['propose', 'add a migration']);
    const id = proposalHashFor('add a migration');
    const approveResult = run(['propose', '--approve', id]);
    expect(approveResult.status).toBe(0);
    const content = readFileSync(`.nim/proposals/${id}.md`, 'utf8');
    expect(content).toMatch(/approved:\s*\d{4}-\d{2}-\d{2}T/);
  });

  it('a guard-gated run denies before approval and allows after (full propose -> approve -> run workflow)', () => {
    // Isolated scratch cwd — see the SCRATCH_DIR comment above for why this
    // must NOT be the shared repo root.
    mkdirSync(SCRATCH_DIR, { recursive: true });
    writeFileSync(
      `${SCRATCH_DIR}/nim.json`,
      JSON.stringify({ harness: { guard: { propose: { require: true, proposalsDir: '.nim/proposals' } } } }),
    );
    const cmd = 'node -e "console.log(1)"';
    const runInScratch = (args: string[]) => spawnSync('node', [cliPath, ...args], { encoding: 'utf8', cwd: SCRATCH_DIR });

    // 1) deny — no proposal yet for this exact task description (cli.run uses skill.name = 'cli.run' as
    // its taskDescription today, per runtime.ts's checkPolicy call — proposing/approving that exact name).
    const denied = runInScratch(['run', cmd]);
    expect(denied.status).not.toBe(0);
    expect(denied.stderr).toMatch(/proposal_required/);

    // 2) propose + approve for the task description cli.run's execute() is actually checked against
    runInScratch(['propose', 'cli.run']);
    const id = proposalHashFor('cli.run');
    runInScratch(['propose', '--approve', id]);

    // 3) allow — now that 'cli.run' has an approved proposal
    const allowed = runInScratch(['run', cmd]);
    expect(allowed.status).toBe(0);
  });
});
