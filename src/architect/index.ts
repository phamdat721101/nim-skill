import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { z } from 'zod';
import { createSearchHelper, type SearchResultEntry } from '../search/index.js';
import { systemMapPath, systemMapTemplate } from '../deliver/map.js';

export type DepthClassification = 'deep' | 'balanced' | 'shallow' | 'barrel';
export type RedFlag = 'shallow-module' | 'pass-through-method' | 'information-leakage' | 'temporal-coupling' | 'over-abstraction' | 'premature-optimization';

export interface ModuleDepthReport {
  filePath: string;
  exportedSymbolsCount: number;
  internalLinesCount: number;
  avgPublicCyclomaticComplexity: number;
  depthScore: number;
  classification: DepthClassification;
}

export interface RedFlagViolation { flag: RedFlag; filePath: string; symbolName: string; line: number; description: string; remedy: string; }
export interface GroundReport { target: string; files: string[]; imports: Array<{ filePath: string; imports: string[] }>; lessons: SearchResultEntry[]; unsupported: string[]; }
export interface DesignSketch { title: string; summary: string; tradeoffs: string[]; }
export type ArchitectCritique = (input: { spec: string; sketches: DesignSketch[] }) => Promise<DesignSketch[]>;

export const DecisionRecordSchema = z.object({
  id: z.string().min(1), dNumber: z.string().regex(/^D\d+$/), timestamp: z.string().datetime(), title: z.string().min(1), branch: z.string().min(1),
  eli10: z.string().min(1), stakes: z.string().min(1), selectedOption: z.string().min(1), recommendation: z.string().min(1),
  completenessScore: z.number().int().min(1).max(10), rationale: z.string().min(1), isShortcut: z.boolean(), shortcutCeiling: z.string().nullable(),
  upgradeTrigger: z.string().nullable(), touchedFiles: z.array(z.string()), status: z.enum(['settled', 'superseded']), supersedes: z.string().nullable(),
});
export type DecisionRecord = z.infer<typeof DecisionRecordSchema>;
export type NewDecision = Omit<DecisionRecord, 'id' | 'timestamp' | 'status'> & { status?: DecisionRecord['status'] };

function lineCount(node: ts.Node, source: ts.SourceFile): number {
  return source.getLineAndCharacterOfPosition(node.getEnd()).line - source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

export function calculateCyclomatic(node: ts.Node): number {
  let complexity = 1;
  const visit = (child: ts.Node) => {
    if (ts.isIfStatement(child) || ts.isForStatement(child) || ts.isForInStatement(child) || ts.isForOfStatement(child) || ts.isWhileStatement(child) || ts.isDoStatement(child) || ts.isCaseClause(child) || child.kind === ts.SyntaxKind.CatchClause || child.kind === ts.SyntaxKind.AmpersandAmpersandToken || child.kind === ts.SyntaxKind.BarBarToken || child.kind === ts.SyntaxKind.QuestionQuestionToken) complexity++;
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return complexity;
}

export function isBarrel(source: ts.SourceFile): boolean {
  return source.statements.length > 0 && source.statements.every((statement) => ts.isExportDeclaration(statement) || (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)));
}

export function scoreModuleDepth(source: ts.SourceFile): ModuleDepthReport {
  const exported = source.statements.filter((node) => ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
  const totalLines = source.getLineAndCharacterOfPosition(source.end).line + 1;
  const exportedLines = exported.reduce((sum, node) => sum + lineCount(node, source), 0);
  const complexity = exported.length ? exported.reduce((sum, node) => sum + calculateCyclomatic(node), 0) / exported.length : 1;
  const depth = exported.length ? Number((Math.max(0, totalLines - exportedLines) / (exported.length * Math.max(1, complexity))).toFixed(2)) : 0;
  const classification: DepthClassification = isBarrel(source) ? 'barrel' : depth >= 15 ? 'deep' : depth < 5 ? 'shallow' : 'balanced';
  return { filePath: source.fileName, exportedSymbolsCount: exported.length, internalLinesCount: Math.max(0, totalLines - exportedLines), avgPublicCyclomaticComplexity: Number(complexity.toFixed(2)), depthScore: depth, classification };
}

function nameOf(node: ts.FunctionLikeDeclarationBase): string { return node.name && ts.isIdentifier(node.name) ? node.name.text : '<anonymous>'; }
function directForward(node: ts.FunctionLikeDeclarationBase): boolean {
  const body = node.body;
  const statement = body && ts.isBlock(body) && body.statements.length === 1 ? body.statements[0] : undefined;
  if (!statement || !ts.isReturnStatement(statement) || !statement.expression || !ts.isCallExpression(statement.expression)) return false;
  const params = node.parameters.map((parameter) => parameter.name.getText());
  const args = statement.expression.arguments.map((argument) => argument.getText());
  return params.length > 0 && params.length === args.length && params.every((parameter, index) => parameter === args[index]);
}

export function auditRedFlags(source: ts.SourceFile): RedFlagViolation[] {
  const findings: RedFlagViolation[] = [];
  const depth = scoreModuleDepth(source);
  if (depth.classification === 'shallow' && depth.exportedSymbolsCount > 3) findings.push({ flag: 'shallow-module', filePath: source.fileName, symbolName: '<module>', line: 1, description: 'Public surface is shallow relative to hidden implementation.', remedy: 'Combine wrappers or move behavior behind a smaller interface.' });
  const visit = (node: ts.Node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && directForward(node)) findings.push({ flag: 'pass-through-method', filePath: source.fileName, symbolName: nameOf(node), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, description: 'Method forwards every argument without transformation.', remedy: 'Remove the wrapper or give it meaningful behavior.' });
    if ((ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) && /^(init|setup|connect)$/i.test(nameOf(node))) findings.push({ flag: 'temporal-coupling', filePath: source.fileName, symbolName: nameOf(node), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, description: 'Setup-like public method can require call ordering.', remedy: 'Return an initialized object from a factory or encode state in types.' });
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return findings;
}

function walk(root: string): string[] {
  if (!existsSync(root)) throw new Error(`nim: target does not exist: ${root}`);
  if (statSync(root).isFile()) return [root];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.') ? [] : walk(join(root, entry.name)));
}

export function groundArchitecture(target: string, query = 'architecture design failure'): GroundReport {
  const resolved = resolve(target); const all = walk(resolved); const files = all.filter((file) => /\.(tsx?|mts|cts)$/.test(file));
  const imports = files.map((file) => { const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true); return { filePath: file, imports: source.statements.filter(ts.isImportDeclaration).map((statement) => ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : '') }; });
  const candidates = [join(resolved, '.nim/agent-support-log.md'), join(resolved, '.nim/lessons.jsonl')].filter(existsSync);
  return { target: resolved, files, imports, lessons: candidates.length ? createSearchHelper({ topK: 5 }).searchFiles(query, candidates) : [], unsupported: all.filter((file) => !/\.(tsx?|mts|cts)$/.test(file)) };
}

export async function sketchArchitecture(spec: string, critique?: ArchitectCritique): Promise<DesignSketch[]> {
  const sketches: DesignSketch[] = [
    { title: 'Deep module boundary', summary: `Hide implementation complexity behind a narrow contract for: ${spec}`, tradeoffs: ['Smaller public API', 'More internal responsibility'] },
    { title: 'Composable pipeline', summary: `Separate parsing, decisions, and delivery compilation for: ${spec}`, tradeoffs: ['Independent verification', 'More explicit data contracts'] },
  ];
  return critique ? critique({ spec, sketches }) : sketches;
}

export class DecisionLedger {
  constructor(private readonly root = process.cwd()) {}
  private get path(): string { return join(this.root, '.nim', 'decisions.jsonl'); }
  all(): DecisionRecord[] { if (!existsSync(this.path)) return []; return readFileSync(this.path, 'utf8').split('\n').flatMap((line) => { try { return line.trim() ? [DecisionRecordSchema.parse(JSON.parse(line))] : []; } catch { return []; } }); }
  append(input: NewDecision): DecisionRecord {
    const record = DecisionRecordSchema.parse({ ...input, id: `dec-${Date.now().toString(36)}`, timestamp: new Date().toISOString(), status: input.status ?? 'settled' });
    mkdirSync(join(this.root, '.nim'), { recursive: true }); appendFileSync(this.path, `${JSON.stringify(record)}\n`, 'utf8'); return record;
  }
  verifyDebtAnchors(paths: string[]): { valid: boolean; missingLedgerIds: string[] } {
    const ids = new Set(this.all().map((record) => record.id)); const missingLedgerIds: string[] = [];
    for (const path of paths) if (existsSync(path)) for (const match of readFileSync(path, 'utf8').matchAll(/nim-shortcut\((dec-[\w-]+)\)/g)) if (!ids.has(match[1]!)) missingLedgerIds.push(`${path}: ${match[1]}`);
    return { valid: missingLedgerIds.length === 0, missingLedgerIds };
  }
}

export function compileArchitecture(root: string, feature: string): { prdPath: string; systemMap: string } {
  const ledger = new DecisionLedger(root); const decisions = ledger.all(); const outputDir = join(root, 'docs', 'features'); mkdirSync(outputDir, { recursive: true });
  const prdPath = join(outputDir, `${feature}-architecture.md`);
  writeFileSync(prdPath, `# ${feature} architecture\n\n## Decisions\n\n${decisions.map((decision) => `- ${decision.dNumber}: ${decision.title} (${decision.selectedOption})`).join('\n') || '- No settled decisions.'}\n\n## Acceptance criteria\n\n- Architecture edge proofs pass.\n- No orphaned nim-shortcut anchors remain.\n`);
  const systemMap = systemMapPath(feature, 'docs/features'); const mapPath = join(root, systemMap);
  if (!existsSync(mapPath)) writeFileSync(mapPath, systemMapTemplate(feature, 'feature'));
  return { prdPath: relative(root, prdPath), systemMap };
}
