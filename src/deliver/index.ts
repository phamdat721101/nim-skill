/**
 * Deterministic delivery-contract checks. This module deliberately validates
 * declared local evidence; it never reads secrets, resolves DNS, or calls a
 * deployment API.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CheckResult } from '../harness/types.js';

export type DeliveryPhase = 'pre' | 'post';

export interface DeliveryProfileConfig {
  contract: string;
  configFiles?: string[];
  commands?: string[];
  evidenceFile?: string;
}

export interface DeliveryConfig {
  mode: 'warn' | 'strict' | 'off';
  briefDir: string;
  profiles: Record<string, DeliveryProfileConfig>;
  requireWorkrule: boolean;
}

interface SecretBinding { key: string; binding: string; required?: boolean }
interface TlsTarget { host: string; ssl: boolean; verification: 'provider-endpoint' | 'certificate-san' | 'disabled' }
interface Collateral { dependency: string; behavior: string; resolution: 'configured' | 'disabled' }
interface DeliveryContract { secrets?: SecretBinding[]; tls?: TlsTarget[]; collateral?: Collateral[] }

export interface DeliveryReport {
  profile: string;
  phase: DeliveryPhase;
  checkedAt: string;
  passed: boolean;
  checks: CheckResult[];
}

export type DeliveryCommandRunner = (command: string) => { ok: boolean; detail?: string };

const REQUIRED_BRIEF_SECTIONS = [
  'client outcome', 'audience', 'scope', 'non-goals', 'alternatives considered',
  'selected approach and why', 'risks', 'acceptance criteria', 'rollout and rollback',
  'environment contract', 'post-delivery evidence',
];

function check(strategy: string, pass: boolean, reason?: string): CheckResult {
  return { strategy, pass, ...(pass ? {} : { reason }) };
}

function loadJson<T>(file: string, label: string): T | null {
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')) as T; } catch { throw new Error(`nim: ${label} is not valid JSON: ${file}`); }
}

function findBrief(root: string, briefDir: string, briefFile?: string): { path: string; content: string } | null {
  if (briefFile) {
    const path = resolve(root, briefFile);
    return existsSync(path) ? { path, content: readFileSync(path, 'utf8') } : null;
  }
  const dir = resolve(root, briefDir);
  if (!existsSync(dir)) return null;
  const candidate = readdirSync(dir).filter((name) => name.endsWith('.md')).sort().at(-1);
  return candidate ? { path: join(dir, candidate), content: readFileSync(join(dir, candidate), 'utf8') } : null;
}

function validateBrief(root: string, cfg: DeliveryConfig, briefFile?: string): CheckResult {
  const brief = findBrief(root, cfg.briefDir, briefFile);
  if (!brief) return check('DELIVER-01 product brief', false, `no feature brief found in ${cfg.briefDir}`);
  const sections = new Set([...brief.content.matchAll(/^##\s+(.+)$/gmi)].map((m) => m[1]!.trim().toLowerCase()));
  const missing = REQUIRED_BRIEF_SECTIONS.filter((section) => !sections.has(section));
  return check('DELIVER-01 product brief', missing.length === 0, missing.length ? `missing required brief sections: ${missing.join(', ')}` : undefined);
}

function validateContract(root: string, profile: DeliveryProfileConfig): { contract: DeliveryContract | null; checks: CheckResult[] } {
  const contractPath = resolve(root, profile.contract);
  const contract = loadJson<DeliveryContract>(contractPath, 'environment contract');
  if (!contract) return { contract: null, checks: [check('DELIVER-02 environment contract', false, `contract missing: ${profile.contract}`)] };
  const source = (profile.configFiles ?? []).map((file) => existsSync(resolve(root, file)) ? readFileSync(resolve(root, file), 'utf8') : '').join('\n');
  const missing = (contract.secrets ?? []).filter((secret) => secret.required !== false && !new RegExp(`\\$\\{${secret.key}(?=[:}])`).test(source));
  return { contract, checks: [check('DELIVER-02 environment contract', missing.length === 0, missing.length ? `missing explicit placeholders for: ${missing.map((s) => s.key).join(', ')}` : undefined)] };
}

/** Public enforcer hook: validate only explicit secret-to-placeholder bindings. */
export function checkEnvironmentContract(root: string, contract: string, configFiles: string[] = []): CheckResult {
  return validateContract(root, { contract, configFiles }).checks[0]!;
}

function validateTls(contract: DeliveryContract): CheckResult {
  const unsafe = (contract.tls ?? []).filter((target) => target.ssl && target.verification === 'disabled');
  const incomplete = (contract.tls ?? []).filter((target) => target.ssl && !target.verification);
  const offenders = [...unsafe, ...incomplete].map((target) => target.host);
  return check('DELIVER-03 TLS transport', offenders.length === 0, offenders.length ? `TLS hostname verification must use a provider endpoint or certificate SAN policy: ${offenders.join(', ')}` : undefined);
}

const KNOWN_COLLATERAL: Record<string, string[]> = {
  'spring-boot-starter-data-redis': ['redis-health', 'redis-repositories'],
};

function validateCollateral(root: string, contract: DeliveryContract): CheckResult {
  const manifests = ['build.gradle', 'build.gradle.kts', 'pom.xml', 'package.json']
    .filter((file) => existsSync(resolve(root, file)))
    .map((file) => readFileSync(resolve(root, file), 'utf8')).join('\n');
  const missing: string[] = [];
  for (const [dependency, behaviors] of Object.entries(KNOWN_COLLATERAL)) {
    if (!manifests.includes(dependency)) continue;
    for (const behavior of behaviors) {
      if (!(contract.collateral ?? []).some((item) => item.dependency === dependency && item.behavior === behavior)) missing.push(`${dependency}:${behavior}`);
    }
  }
  return check('DELIVER-04 dependency side effects', missing.length === 0, missing.length ? `missing declared collateral behavior: ${missing.join(', ')}` : undefined);
}

function validatePostEvidence(root: string, profile: string, config: DeliveryProfileConfig): CheckResult {
  const path = resolve(root, config.evidenceFile ?? `.nim/deliver/${profile}-evidence.json`);
  const evidence = loadJson<Record<string, unknown>>(path, 'post-delivery evidence');
  const required = ['source', 'buildId', 'target', 'timestamp', 'health', 'clientAcceptance'];
  const missing = !evidence ? required : required.filter((key) => typeof evidence[key] !== 'string' || !(evidence[key] as string).trim());
  return check('DELIVER-06 post-delivery evidence', missing.length === 0, missing.length ? `missing independent post-delivery evidence: ${missing.join(', ')}` : undefined);
}

export function deliveryBriefTemplate(task: string): string {
  return `# ${task.trim()}\n\n## Client outcome\n\n- REVIEW REQUIRED\n\n## Audience\n\n- REVIEW REQUIRED\n\n## Scope\n\n- REVIEW REQUIRED\n\n## Non-goals\n\n- REVIEW REQUIRED\n\n## Alternatives considered\n\n- REVIEW REQUIRED\n\n## Selected approach and why\n\n- REVIEW REQUIRED\n\n## Risks\n\n- REVIEW REQUIRED\n\n## Acceptance criteria\n\n- REVIEW REQUIRED\n\n## Rollout and rollback\n\n- REVIEW REQUIRED\n\n## Environment contract\n\n- REVIEW REQUIRED\n\n## Post-delivery evidence\n\n- REVIEW REQUIRED\n`;
}

export function runDeliveryCheck(root: string, config: DeliveryConfig, profile: string, phase: DeliveryPhase, runner?: DeliveryCommandRunner, hasWorkruleEntry = false, briefFile?: string): DeliveryReport {
  if (config.mode === 'off') return { profile, phase, checkedAt: new Date().toISOString(), passed: true, checks: [] };
  const profileConfig = config.profiles[profile];
  if (!profileConfig) return { profile, phase, checkedAt: new Date().toISOString(), passed: false, checks: [check('DELIVER profile', false, `profile not configured: ${profile}`)] };
  const checks = [validateBrief(root, config, briefFile)];
  const environment = validateContract(root, profileConfig);
  checks.push(...environment.checks);
  if (environment.contract) checks.push(validateTls(environment.contract), validateCollateral(root, environment.contract));
  for (const command of profileConfig.commands ?? []) {
    const result = runner?.(command) ?? { ok: false, detail: 'no command runner configured' };
    checks.push(check(`DELIVER-05 command(${command})`, result.ok, result.detail));
  }
  if (config.requireWorkrule) checks.push(check('DELIVER-05 workrule', hasWorkruleEntry, 'no nim-deliver workrule entry found'));
  if (phase === 'post') checks.push(validatePostEvidence(root, profile, profileConfig));
  return { profile, phase, checkedAt: new Date().toISOString(), passed: checks.every((item) => item.pass), checks };
}
