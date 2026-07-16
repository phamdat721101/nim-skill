/**
 * src/baseline/scaffold.ts
 * -------------------------
 * Generates a new memory file that starts compliant by construction — a thin
 * index, not a dump. Output must round-trip through `lint()` with 0 findings
 * (self-consistency test, per `07-nim-baseline.md` §7). No generic advice, no
 * lint-duplicate phrasing, no task-specific clustering, well under maxLines.
 */

export interface ScaffoldAnswers {
  projectType: string;
  testCmd: string;
  buildCmd: string;
  styleDeviations: string[];
}

/** Build a compliant starter memory file from a short interview. */
export function scaffold(answers: ScaffoldAnswers): string {
  const deviations = answers.styleDeviations.length
    ? answers.styleDeviations.map((d) => `- ${d}`).join('\n')
    : '- None yet — add project-specific deviations here as they come up.';

  return `# Project orientation

\`${answers.projectType}\` project.

## Commands

- Test: \`${answers.testCmd}\`
- Build: \`${answers.buildCmd}\`

## Style deviations from defaults

${deviations}

## Layout

Describe the top-level directories here in one line each.
`;
}
