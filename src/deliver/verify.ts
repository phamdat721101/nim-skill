import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CheckResult } from '../harness/types.js';
import { EDGE_IDS, type DeliveryVerifyReport, type SystemMap } from './types.js';

export type DeliveryTestRunner = (command: string) => { ok: boolean; detail?: string };
const check = (strategy: string, pass: boolean, reason?: string): CheckResult => ({ strategy, pass, ...(pass ? {} : { reason }) });

export function verifySystemMap(root: string, map: SystemMap, runner: DeliveryTestRunner): DeliveryVerifyReport {
  const checks: CheckResult[] = [check('DELIVERY-01 status', map.status === 'Done', 'System Map must be marked Done before verification')];
  const seamIds = new Set(map.seams.map((seam) => seam.id));
  for (const edgeId of EDGE_IDS) {
    const proof = map.edgeProofs.find((candidate) => candidate.edgeId === edgeId);
    checks.push(check(`DELIVERY-02 ${edgeId} proof`, !!proof, `missing executable proof for ${edgeId}`));
    if (!proof) continue;
    checks.push(check(`DELIVERY-03 ${edgeId} seam`, seamIds.has(proof.seamId), `proof cites undeclared seam: ${proof.seamId}`));
    const sources = proof.sourceFiles.map((file) => resolve(root, file));
    const logFound = sources.some((file) => existsSync(file) && readFileSync(file, 'utf8').includes(proof.logMarker));
    checks.push(check(`DELIVERY-04 ${edgeId} seam log`, logFound, `structured log marker not found: ${proof.logMarker}`));
    const result = runner(proof.command);
    checks.push(check(`DELIVERY-05 ${edgeId} test(${proof.command})`, result.ok, result.detail));
  }
  return { passed: checks.every((item) => item.pass), checks };
}

export function format3LineHandover(feature: string, flow: string, edges: string[]): string {
  return `Feature: ${feature}\nFlow: ${flow}\nEdges: ${edges.join(', ')}`;
}
