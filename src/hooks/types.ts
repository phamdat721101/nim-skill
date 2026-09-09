import type { ErrorClass } from '../harness/types.js';

/** Configured once by the installer; a project can explicitly disable it. */
export interface HooksConfig {
  enabled: boolean;
  profile: 'default';
  memoryFiles: string[];
  search: { topK: number; maxTokens: number };
  auditor: { enabled: boolean; threshold: number; mode: 'strict' | 'warn' | 'off'; store: string };
}

export type HookHost = 'claude' | 'codex' | 'kiro' | 'cursor';
export type HookEvent = 'start' | 'prompt' | 'pre-tool' | 'post-tool' | 'end';

export interface HookAction {
  toolName: string;
  actionKey?: string | null;
  pathScope?: string | null;
}

export interface FailureInput extends HookAction {
  source: 'host' | 'harness';
  message: string;
  errorClass: ErrorClass;
  errorType?: string | null;
  eventId?: string | null;
}

export interface AuditorDecision {
  allowed: boolean;
  actionId: string;
  fingerprint?: string;
  count?: number;
  reason?: string;
}

export interface ReplanInput {
  taskId: string;
  fingerprint: string;
  rootCause: string;
  alternatives: string[];
  selected: string;
  nextAction: string;
}

export interface AuditorStatus {
  taskId: string;
  host?: HookHost;
  startedAt?: string;
  failures: Array<{ fingerprint: string; actionId: string; count: number; lastAt: string }>;
  blocked: string[];
  completed: string[];
}
