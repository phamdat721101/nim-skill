import { describe, it, expect, beforeAll } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';

const cliPath = `${process.cwd()}/dist/cli.js`;

beforeAll(() => {
  execSync('npm run build', { cwd: process.cwd(), stdio: 'pipe' });
}, 60_000);

/** A command that emits 500+ lines, one of which is a real ERROR marker. Uses string concatenation (not a template literal) to avoid backticks breaking under the outer shell's nested quoting. */
const BIG_OUTPUT_CMD =
  'node -e "for (let i = 0; i < 500; i++) console.log(i === 250 ? \'ERROR: boom\' : \'info: step \' + i)"';

describe('nim-skill run --logcompact (Task 3 e2e)', () => {
  it('compacts large stdout down to a small, error-preserving slice', () => {
    const result = spawnSync('node', [cliPath, 'run', BIG_OUTPUT_CMD, '--logcompact'], {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('ERROR: boom');
    // compacted output should be far fewer lines than the raw 500
    expect(result.stdout.split('\n').length).toBeLessThan(60);
  });

  it('without --logcompact, the raw full output passes through unchanged', () => {
    const result = spawnSync('node', [cliPath, 'run', BIG_OUTPUT_CMD], {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('ERROR: boom');
    // rollback contract: no flag ⇒ byte-identical prior behavior ⇒ all 500 lines present
    expect(result.stdout.split('\n').length).toBeGreaterThanOrEqual(500);
  });

  it('--enforce still verifies the SAME (compacted) text that gets printed — a real failure is never hidden', () => {
    const failingCmd = 'node -e "console.error(\'FATAL: real failure\'); process.exit(1)"';
    const result = spawnSync('node', [cliPath, 'run', failingCmd, '--logcompact', '--enforce'], {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('FATAL: real failure');
  });
});
