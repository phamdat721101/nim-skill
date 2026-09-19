/**
 * src/search/compiler.ts
 * -----------------------
 * Spec Envelope compiler for the AS-SCP graph engine. A "Spec Envelope" is a
 * structured, machine-checkable feature spec: its `dependencies[].symbol`
 * entries are checked against a caller-supplied `knownSymbols` set (typically
 * sourced from `extractSymbols()`/the context graph) BEFORE any file is
 * written — an unresolved symbol blocks compilation entirely rather than
 * producing a spec that references code that doesn't exist.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const SpecEnvelopeZodSchema = z.object({
  spec_id: z.string().regex(/^SPEC-[0-9]{4}-[0-9]{4,6}$/),
  feature_name: z.string().min(5),
  source_evidence: z
    .array(
      z.object({
        source_uri: z.string(),
        entity_id: z.string(),
        hash: z.string(),
      }),
    )
    .optional(),
  dependencies: z.array(
    z.object({
      package_or_module: z.string(),
      symbol: z.string(),
      file_location: z.string(),
    }),
  ),
  architecture: z.object({
    pattern: z.string(),
    isolation_boundaries: z.string(),
    execution_flow: z.array(z.string()),
  }),
  data_contracts: z.object({
    inputs: z.record(z.unknown()),
    outputs: z.record(z.unknown()),
    error_states: z.array(z.string()),
  }),
  test_criteria: z.array(z.string()).min(1),
});

export type SpecEnvelope = z.infer<typeof SpecEnvelopeZodSchema>;

export interface CompileResult {
  valid: boolean;
  markdownPath: string;
  jsonPath: string;
  missingSymbols: string[];
}

function renderMarkdown(spec: SpecEnvelope): string {
  const depsTable = [
    '| Package/Module | Symbol | File Location |',
    '| --- | --- | --- |',
    ...spec.dependencies.map((d) => `| ${d.package_or_module} | ${d.symbol} | ${d.file_location} |`),
  ].join('\n');

  const executionFlow = spec.architecture.execution_flow.map((step, i) => `${i + 1}. ${step}`).join('\n');
  const testChecklist = spec.test_criteria.map((c) => `- [ ] ${c}`).join('\n');

  return `# ${spec.feature_name}

**Spec ID:** ${spec.spec_id}

## Architecture

- **Pattern:** ${spec.architecture.pattern}
- **Isolation boundaries:** ${spec.architecture.isolation_boundaries}

### Execution flow

${executionFlow}

## Dependencies

${depsTable}

## Data contracts

\`\`\`json
${JSON.stringify(spec.data_contracts, null, 2)}
\`\`\`

## Test criteria

${testChecklist}
`;
}

export class SpecCompiler {
  constructor(private readonly workspaceRoot: string = process.cwd()) {}

  private get specsDir(): string {
    return join(this.workspaceRoot, '.nim', 'specs');
  }

  compile(spec: SpecEnvelope, knownSymbols: Set<string>): CompileResult {
    let parsed: SpecEnvelope;
    try {
      parsed = SpecEnvelopeZodSchema.parse(spec);
    } catch {
      return { valid: false, markdownPath: '', jsonPath: '', missingSymbols: ['<spec envelope failed schema validation>'] };
    }

    const missingSymbols = parsed.dependencies
      .filter((dep) => !knownSymbols.has(dep.symbol))
      .map((dep) => `${dep.symbol} (declared in ${dep.file_location})`);

    if (missingSymbols.length > 0) {
      return { valid: false, markdownPath: '', jsonPath: '', missingSymbols };
    }

    if (!existsSync(this.specsDir)) mkdirSync(this.specsDir, { recursive: true });

    const jsonPath = join(this.specsDir, `${parsed.spec_id}.json`);
    const markdownPath = join(this.specsDir, `${parsed.spec_id}.md`);

    writeFileSync(jsonPath, JSON.stringify(parsed, null, 2), 'utf8');
    writeFileSync(markdownPath, renderMarkdown(parsed), 'utf8');

    return { valid: true, markdownPath, jsonPath, missingSymbols: [] };
  }
}
