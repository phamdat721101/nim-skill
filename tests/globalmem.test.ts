import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGlobalMemoryAuditor } from '../src/globalmem/index.js';

describe('nim-globalmem', () => {
  it('reports in-sync copies and majority divergence', () => {
    const auditor = createGlobalMemoryAuditor(); const declaration = { name: 'gstack', paths: ['a', 'b', 'c'] };
    expect(auditor.audit(declaration, { a: 'same', b: 'same', c: 'same' }).inSync).toBe(true);
    expect(auditor.audit(declaration, { a: 'same', b: 'same', c: 'different' }).divergentPaths).toEqual(['c']);
  });
  it('reads declared files and refuses missing input', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nim-global-')); const a = join(dir, 'a'); const b = join(dir, 'b');
    writeFileSync(a, 'same'); writeFileSync(b, 'different');
    expect(createGlobalMemoryAuditor().auditFiles({ name: 'test', paths: [a, b] }).inSync).toBe(false);
    expect(() => createGlobalMemoryAuditor().auditFiles({ name: 'missing', paths: [join(dir, 'none')] })).toThrow(/does not exist/);
  });
});
