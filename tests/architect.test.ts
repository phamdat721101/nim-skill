import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { DecisionLedger, auditRedFlags, compileArchitecture, groundArchitecture, scoreModuleDepth, sketchArchitecture } from '../src/architect/index.js';

const dirs: string[] = [];
function temp(): string { const dir = mkdtempSync(join(tmpdir(), 'nim-architect-')); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('nim-architect', () => {
  it('scores barrel files separately and detects pass-through methods', () => {
    const barrel = ts.createSourceFile('index.ts', "export { value } from './value';", ts.ScriptTarget.Latest, true);
    expect(scoreModuleDepth(barrel).classification).toBe('barrel');
    const wrapper = ts.createSourceFile('wrapper.ts', 'class A { forward(value: string) { return this.target(value); } target(value: string) { return value; } }', ts.ScriptTarget.Latest, true);
    expect(auditRedFlags(wrapper).some((finding) => finding.flag === 'pass-through-method')).toBe(true);
  });

  it('grounds TypeScript and recalls both local memory sources', () => {
    const root = temp(); writeFileSync(join(root, 'app.ts'), "import { x } from './x'; export const value = x;"); writeFileSync(join(root, 'x.ts'), 'export const x = 1;');
    writeFileSync(join(root, 'notes.js'), 'ignored');
    const nim = join(root, '.nim'); mkdirSync(nim); writeFileSync(join(nim, 'agent-support-log.md'), '## Failure\narchitecture boundary broke'); writeFileSync(join(nim, 'lessons.jsonl'), '{"lesson":"architecture failure"}\n');
    const report = groundArchitecture(root, 'architecture failure');
    expect(report.files).toHaveLength(2); expect(report.lessons).toHaveLength(2); expect(report.unsupported.some((file) => file.endsWith('notes.js'))).toBe(true);
  });

  it('persists complete decisions, verifies anchors, and compiles deliver artifacts', async () => {
    const root = temp(); const ledger = new DecisionLedger(root);
    const decision = ledger.append({ dNumber: 'D1', title: 'Boundary', branch: 'main', eli10: 'Keep the hard part hidden.', stakes: 'Callers become coupled.', selectedOption: 'A', recommendation: 'A', completenessScore: 10, rationale: 'Narrow interface.', isShortcut: false, shortcutCeiling: null, upgradeTrigger: null, touchedFiles: [], supersedes: null });
    const source = join(root, 'app.ts'); writeFileSync(source, `// nim-shortcut(${decision.id}): upgrade when needed`);
    expect(ledger.verifyDebtAnchors([source]).valid).toBe(true);
    expect(ledger.verifyDebtAnchors([join(root, 'missing.ts')]).valid).toBe(true);
    expect((await sketchArchitecture('payments')).length).toBe(2);
    const compiled = compileArchitecture(root, 'architect');
    expect(compiled.prdPath).toContain('architect-architecture.md'); expect(compiled.systemMap).toContain('architect-map.md');
  });
});
