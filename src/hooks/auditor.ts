import { createHash } from 'node:crypto';
import { redactSecretText } from '../security/secrets.js';
import type { AuditorDecision, FailureInput, HookAction, ReplanInput } from './types.js';

const volatile = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
  /\b0x[a-f0-9]{16,}\b/gi,
  /\b\d{4}-\d{2}-\d{2}T\d\d:\d\d:\d\d(?:\.\d+)?Z\b/g,
  /\b\d{5,}\b/g,
  /\/private\/var\/folders\/[^\s'"`]+/g,
  /\/tmp\/[^\s'"`]+/g,
];

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function normalizeText(text: string): string {
  let output = redactSecretText(text).toLowerCase().replace(/\s+/g, ' ').trim();
  for (const pattern of volatile) output = output.replace(pattern, '<volatile>');
  // Error renderers commonly vary only an adjacent numeric build/request id.
  output = output.replace(/\d+/g, '<number>');
  return output;
}

export function actionId(action: HookAction): string {
  return hash({ toolName: action.toolName.toLowerCase(), actionKey: normalizeText(action.actionKey ?? ''), pathScope: normalizeText(action.pathScope ?? '') });
}

export function failureFingerprint(input: FailureInput): string {
  return hash({ actionId: actionId(input), errorClass: input.errorClass, errorType: input.errorType?.toLowerCase() ?? null, message: normalizeText(input.message) });
}

export function validateReplan(input: ReplanInput): string | null {
  if (!input.taskId.trim() || !input.fingerprint.trim()) return 'task and fingerprint are required';
  if (!input.rootCause.trim() || !input.selected.trim() || !input.nextAction.trim()) return 'root cause, selected alternative, and next action are required';
  const alternatives = input.alternatives.map((value) => value.trim()).filter(Boolean);
  if (alternatives.length < 2 || new Set(alternatives.map((value) => value.toLowerCase())).size < 2) return 'two distinct alternatives are required';
  return null;
}

export function allow(action: HookAction): AuditorDecision { return { allowed: true, actionId: actionId(action) }; }
