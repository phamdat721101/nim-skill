/**
 * src/grill/compiler.ts
 * ---------------------
 * Pure function: GrillSession → GrillPRD. No I/O, no side effects — fully
 * testable in isolation. The output MUST satisfy the nim-enforcer schema
 * strategy declared in `grill compile`'s harness config:
 *   { kind: 'schema', required: ['sessionId', 'resolvedDecisions', 'acceptanceCriteria'] }
 *
 * The enforcer's self-heal loop (maxHeals:2) feeds `_feedback` back when
 * required fields are missing — this function is the reExecute() target.
 */

import type { GrillSession, GrillPRD } from './types.js';

/**
 * Compile a resolved GrillSession into an immutable GrillPRD.
 * All resolved answers are mapped to `resolvedDecisions`.
 * Questions with no answer remain as `unresolvedTradeoffs`.
 * `acceptanceCriteria` is derived from resolved decisions for test gating.
 */
export function compilePRD(session: GrillSession): GrillPRD {
  const resolvedDecisions = session.answers.map((a) => ({
    questionId: a.questionId,
    question: session.questions.find((q) => q.id === a.questionId)?.text ?? '',
    answer: a.answer,
  }));

  const answeredIds = new Set(session.answers.map((a) => a.questionId));
  const unresolvedTradeoffs = session.questions
    .filter((q) => !answeredIds.has(q.id))
    .map((q) => q.text);

  const acceptanceCriteria = resolvedDecisions.map(
    (r) => `[${r.questionId}] ${r.answer.slice(0, 120)}${r.answer.length > 120 ? '…' : ''}`,
  );

  return {
    sessionId: session.id,
    domain: session.domain,
    compiledAt: new Date().toISOString(),
    resolvedDecisions,
    unresolvedTradeoffs,
    acceptanceCriteria,
  };
}

/**
 * Format a GrillPRD as a markdown document for writing to
 * `.nim/grill/<session-id>-prd.md`. Pure function — no I/O.
 */
export function formatPRDMarkdown(prd: GrillPRD): string {
  const lines: string[] = [
    `# Grill-Me PRD — ${prd.domain}`,
    ``,
    `**Session**: \`${prd.sessionId}\`  `,
    `**Compiled**: ${prd.compiledAt}`,
    ``,
    `## Resolved Decisions`,
    ``,
    ...prd.resolvedDecisions.flatMap((d) => [
      `### \`${d.questionId}\``,
      ``,
      `**Q**: ${d.question}`,
      ``,
      `**A**: ${d.answer}`,
      ``,
    ]),
    `## Acceptance Criteria`,
    ``,
    ...prd.acceptanceCriteria.map((c) => `- ${c}`),
    ``,
  ];

  if (prd.unresolvedTradeoffs.length > 0) {
    lines.push(
      `## Unresolved Tradeoffs`,
      ``,
      ...prd.unresolvedTradeoffs.map((t) => `- ${t}`),
      ``,
    );
  }

  return lines.join('\n');
}
