/**
 * Agent-ready workspace bootstrap helpers.
 *
 * These helpers intentionally own only repository state scaffolding. They do
 * not inspect or modify application code, and never replace existing files.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type WorkspaceKind = 'greenfield' | 'brownfield';

export interface WorkspaceAssessment {
  kind: WorkspaceKind;
  stack: string[];
  evidence: string[];
  dataModelPaths: string[];
  reviewRequired: string[];
}

export interface SetupReport {
  kind: WorkspaceKind;
  created: string[];
  skipped: string[];
  assessment: WorkspaceAssessment;
  reviewRequired: string[];
}

export interface HandoffInput {
  goal: string;
  output: string;
  next: string;
  blocker?: string;
  attempted?: string[];
}

function projectPath(root: string, path: string): string {
  return join(resolve(root), path);
}

function nonempty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`nim: --${label} must not be empty`);
  return trimmed;
}

function readPackage(root: string): Record<string, unknown> | null {
  const file = projectPath(root, 'package.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Deterministic, evidence-carrying assessment; uncertain facts stay uncertain. */
export function assessWorkspace(root: string): WorkspaceAssessment {
  const evidence: string[] = [];
  const stack = new Set<string>();
  const dataModelPaths: string[] = [];
  const manifest = (path: string, label: string, technology?: string): void => {
    if (!existsSync(projectPath(root, path))) return;
    evidence.push(`${path} (${label})`);
    if (technology) stack.add(technology);
  };

  const pkg = readPackage(root);
  if (pkg) {
    evidence.push('package.json (Node.js project manifest)');
    stack.add('node');
    const deps = { ...(pkg.dependencies as Record<string, unknown> | undefined), ...(pkg.devDependencies as Record<string, unknown> | undefined) };
    if ('typescript' in deps) stack.add('typescript');
    if ('react' in deps || 'next' in deps) stack.add('react');
  }
  manifest('pyproject.toml', 'Python project manifest', 'python');
  manifest('requirements.txt', 'Python dependency manifest', 'python');
  manifest('go.mod', 'Go module manifest', 'go');
  manifest('Cargo.toml', 'Rust package manifest', 'rust');
  manifest('pom.xml', 'Maven project manifest', 'java');
  manifest('build.gradle', 'Gradle project manifest', 'java');
  manifest('build.gradle.kts', 'Gradle project manifest', 'kotlin');
  for (const path of ['prisma', 'schema', 'migrations', 'db', 'database', 'models']) {
    if (existsSync(projectPath(root, path))) dataModelPaths.push(path);
  }

  const kind: WorkspaceKind = evidence.length === 0 ? 'greenfield' : 'brownfield';
  const reviewRequired = [
    'Review CONSTITUTION.md before relying on inferred stack or architectural invariants.',
    ...(stack.size === 0 ? ['Declare the project tech stack and test command.'] : []),
    ...(dataModelPaths.length === 0 ? ['Confirm data-model locations or state that the project has none.'] : []),
  ];
  return { kind, stack: [...stack], evidence, dataModelPaths, reviewRequired };
}

function constitution(assessment: WorkspaceAssessment): string {
  const stack = assessment.stack.length ? assessment.stack.join(', ') : 'REVIEW REQUIRED';
  const evidence = assessment.evidence.length ? assessment.evidence.map((item) => `- ${item}`).join('\n') : '- No project manifests detected.';
  const models = assessment.dataModelPaths.length ? assessment.dataModelPaths.map((item) => `- \`${item}/\``).join('\n') : '- REVIEW REQUIRED: no conventional data-model directory detected.';
  return `# Constitution\n\n## Tech stack and tooling\n\n- Detected stack: ${stack}.\n- Evidence:\n${evidence}\n- REVIEW REQUIRED: confirm supported versions, approved libraries, and the canonical test command.\n\n## Architectural invariants\n\n- Keep application behavior, infrastructure boundaries, and data ownership explicit in each feature brief.\n- Do not introduce a new integration, persistence boundary, or generated artifact without documenting it in that feature brief.\n- Data-model locations:\n${models}\n\n## Agentic contract\n\n- Do not write application code while preparing this workspace harness.\n- Before ending, being interrupted, or switching tasks, append a structured handoff to \`docs/state/active_session.md\`.\n- Read this constitution, the relevant feature brief, and the final handoff snapshot before starting work.\n- Run the project test command before declaring a feature complete.\n\n## Definition of done\n\n- Feature acceptance criteria pass.\n- Relevant tests and verification commands pass.\n- The final handoff snapshot records outcome, blockers, attempted solutions, and next steps.\n\n## Human review required\n\n${assessment.reviewRequired.map((item) => `- ${item}`).join('\n')}\n`;
}

function initialSession(): string {
  return `# Active session\n\nRead the final \`## Session\` entry as the current handoff state. This file is append-only.\n\n## Session ${new Date().toISOString()}\n\n### Current goal\n\nSet up the agent-ready workspace harness.\n\n### Latest output or blocker\n\nHarness setup completed; review \`CONSTITUTION.md\` before feature work.\n\n### Attempted solutions\n\n- Assessed repository manifests and created only missing harness artifacts.\n\n### Next steps\n\n- Human reviews and confirms the constitution.\n- Create a feature brief with \`nim-skill workspace feature <name>\`.\n`;
}

function defaultNimJson(assessment: WorkspaceAssessment): string {
  return `${JSON.stringify({
    harness: {
      enforcer: { strategies: ['nonempty'], mode: 'strict', maxHeals: 0 },
      memory: { verifyCache: true, priors: true, store: '.nim/memory.jsonl', sessionStore: '.nim/sessions.jsonl' },
      context: { progressive: true, maxInputTokens: 8000, onExceed: 'compact' },
      logCompact: { strategy: 'errors-only', maxLines: 100, escalateOnEmpty: true },
    },
    workspace: {
      stack: assessment.stack,
      livenessFile: 'docs/state/active_session.md',
      mode: 'warn',
      deliver: {
        mode: 'strict',
        briefDir: 'docs/features',
        requireWorkrule: true,
        profiles: { default: { contract: '.nim/deliver/default-contract.json', configFiles: [], commands: [] } },
      },
    },
    workrule: { logFile: '.nim/agent-support-log.md' },
  }, null, 2)}\n`;
}

function createMissing(root: string, relativePath: string, content: string, dryRun: boolean, report: SetupReport): void {
  const file = projectPath(root, relativePath);
  if (existsSync(file)) {
    report.skipped.push(relativePath);
    return;
  }
  report.created.push(relativePath);
  if (!dryRun) {
    mkdirSync(resolve(file, '..'), { recursive: true });
    writeFileSync(file, content);
  }
}

export function initializeWorkspace(root: string, dryRun = false): SetupReport {
  const resolved = resolve(root);
  if (!existsSync(resolved)) throw new Error(`nim: workspace directory does not exist: ${root}`);
  const assessment = assessWorkspace(resolved);
  const report: SetupReport = { kind: assessment.kind, created: [], skipped: [], assessment, reviewRequired: assessment.reviewRequired };
  for (const dir of ['docs/features', 'docs/state', '.nim/deliver']) {
    const path = projectPath(resolved, dir);
    if (existsSync(path)) report.skipped.push(`${dir}/`);
    else {
      report.created.push(`${dir}/`);
      if (!dryRun) mkdirSync(path, { recursive: true });
    }
  }
  createMissing(resolved, '.nim/deliver/default-contract.json', `${JSON.stringify({
    secrets: [],
    tls: [],
    collateral: [],
  }, null, 2)}\n`, dryRun, report);
  createMissing(resolved, 'CONSTITUTION.md', constitution(assessment), dryRun, report);
  createMissing(resolved, 'docs/state/active_session.md', initialSession(), dryRun, report);
  createMissing(resolved, 'nim.json', defaultNimJson(assessment), dryRun, report);
  return report;
}

export function featurePath(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug) throw new Error('nim: feature name must contain letters or numbers');
  return `docs/features/${slug}.md`;
}

export function createFeatureBrief(root: string, name: string, dryRun = false): { path: string; created: boolean } {
  const path = featurePath(name);
  const file = projectPath(root, path);
  if (existsSync(file)) return { path, created: false };
  if (!dryRun) {
    mkdirSync(resolve(file, '..'), { recursive: true });
    writeFileSync(file, `# ${name.trim()}\n\n## System boundaries\n\n- REVIEW REQUIRED\n\n## Data models\n\n- REVIEW REQUIRED\n\n## Tracer-bullet path\n\n1. REVIEW REQUIRED\n\n## Acceptance criteria\n\n- REVIEW REQUIRED\n`);
  }
  return { path, created: true };
}

export function appendHandoff(root: string, input: HandoffInput, dryRun = false): { path: string; appended: boolean } {
  const goal = nonempty(input.goal, 'goal');
  const output = nonempty(input.output, 'output');
  const next = nonempty(input.next, 'next');
  const path = projectPath(root, 'docs/state/active_session.md');
  const attempted = input.attempted?.filter((item) => item.trim()).map((item) => `- ${item.trim()}`).join('\n') || '- None recorded.';
  const latest = input.blocker?.trim() ? `${output}\n\nBlocker: ${input.blocker.trim()}` : output;
  const entry = `\n## Session ${new Date().toISOString()}\n\n### Current goal\n\n${goal}\n\n### Latest output or blocker\n\n${latest}\n\n### Attempted solutions\n\n${attempted}\n\n### Next steps\n\n${next}\n`;
  if (!dryRun) {
    mkdirSync(resolve(path, '..'), { recursive: true });
    if (!existsSync(path)) writeFileSync(path, '# Active session\n\nRead the final `## Session` entry as the current handoff state. This file is append-only.\n');
    appendFileSync(path, entry);
  }
  return { path: 'docs/state/active_session.md', appended: true };
}
