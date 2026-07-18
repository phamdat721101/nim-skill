/**
 * src/lessons/match.ts
 * ---------------------
 * Shape-matching: does a proposed action's {toolName, pathGlob, contentSignal}
 * match a logged lesson's triggerShape? Deterministic glob + literal-equality
 * only, NOT a semantic/embedding search — per "measure, don't guess." A fuzzy
 * semantic-match mode is a named v0.6+ candidate, not built here (04 §3.2).
 *
 * `candidate.pathGlob` represents an actual resolved path being checked; the
 * logged entry's `pathGlob` is the glob pattern it was captured against.
 */

import type { TriggerShape } from './types.js';

/** Translate a simple glob (`*`, `**`, literal segments) into an anchored RegExp. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped
    .replace(/\*\*/g, '\u0000') // placeholder so single-* replace doesn't touch it
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${pattern}$`);
}

function toolNameMatches(candidateTool: string, loggedTool: string): boolean {
  return loggedTool === '*' || candidateTool === loggedTool;
}

function pathMatches(candidatePath: string, loggedGlob: string): boolean {
  if (loggedGlob === '*' || loggedGlob === '**') return true;
  return globToRegExp(loggedGlob).test(candidatePath);
}

function contentSignalMatches(candidateSignal: string | null, loggedSignal: string | null): boolean {
  if (candidateSignal === null || loggedSignal === null) return true; // either side null = wildcard
  return candidateSignal === loggedSignal;
}

/** Deterministic shape match: toolName exact/wildcard, pathGlob via glob test, contentSignal exact/wildcard. */
export function matchesShape(candidate: TriggerShape, logged: TriggerShape): boolean {
  return (
    toolNameMatches(candidate.toolName, logged.toolName) &&
    pathMatches(candidate.pathGlob, logged.pathGlob) &&
    contentSignalMatches(candidate.contentSignal, logged.contentSignal)
  );
}
