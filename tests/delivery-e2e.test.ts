import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { generateThreatMatrix, parseSystemMap, systemMapTemplate, verifySystemMap, type SystemMap } from '../src/deliver/index.js';
import { createWorkspaceGuard } from '../src/workspace/index.js';
import { resolveWorkspaceConfig } from '../src/config.js';

const TMP = '.nim-delivery-e2e-test';
const originalCwd = process.cwd();
afterEach(() => { process.chdir(originalCwd); rmSync(TMP, { recursive: true, force: true }); });

function completeMap(): SystemMap {
  return {
    featureId: 'payments', taskType: 'feature', status: 'Done',
    input: { entrypoint: 'submitPayment', payload: 'PaymentInput' },
    processing: { apiHops: ['POST /payments'], datastores: ['payments'], services: ['gateway'] },
    output: { state: 'complete', transitions: ['IDLE -> PENDING', 'PENDING -> COMPLETE'] },
    seams: [{ id: 'gateway', description: 'payment gateway request' }],
    edgeProofs: ['EDGE-01', 'EDGE-02', 'EDGE-03', 'EDGE-04', 'EDGE-05'].map((edgeId) => ({ edgeId: edgeId as SystemMap['edgeProofs'][number]['edgeId'], seamId: 'gateway', command: 'true', logMarker: 'seam:gateway', sourceFiles: ['src/payment.ts'] })),
  };
}

function markdown(map: SystemMap): string {
  return `# System Map: ${map.featureId}\n\n\`\`\`json nim-deliver\n${JSON.stringify(map, null, 2)}\n\`\`\`\n`;
}

describe('nim-deliver E2E protocol', () => {
  it('creates a deterministic draft map and rejects malformed metadata', () => {
    expect(parseSystemMap(systemMapTemplate('Payments')).status).toBe('Draft');
    expect(() => parseSystemMap('# no metadata')).toThrow(/metadata block/);
  });

  it('derives exactly five seam-anchored threat vectors', () => {
    const threats = generateThreatMatrix(completeMap());
    expect(threats.map((threat) => threat.edgeId)).toEqual(['EDGE-01', 'EDGE-02', 'EDGE-03', 'EDGE-04', 'EDGE-05']);
    expect(threats.every((threat) => threat.seamId === 'gateway')).toBe(true);
  });

  it('requires every executable proof and matching structured seam log', () => {
    mkdirSync(join(TMP, 'src'), { recursive: true });
    writeFileSync(join(TMP, 'src/payment.ts'), "logger.warn({ seam: 'gateway' }); // seam:gateway\n");
    const pass = verifySystemMap(TMP, completeMap(), () => ({ ok: true }));
    expect(pass.passed).toBe(true);
    const failed = verifySystemMap(TMP, { ...completeMap(), edgeProofs: completeMap().edgeProofs.slice(0, 4) }, () => ({ ok: true }));
    expect(failed.passed).toBe(false);
    expect(failed.checks.some((check) => check.strategy.includes('EDGE-05 proof') && !check.pass)).toBe(true);
  });

  it('strictly blocks source writes until the configured feature map is approved', () => {
    mkdirSync(join(TMP, 'docs/features'), { recursive: true });
    process.chdir(TMP);
    const guard = createWorkspaceGuard(resolveWorkspaceConfig({
      stack: ['typescript'], mode: 'strict',
      deliver: { e2e: { enabled: true, featureId: 'payments', codePaths: ['src/'] } },
    }));
    expect(guard.check({ filePath: 'src/payment.ts', content: 'export {}' }).recommendation).toBe('BLOCK');
    const approved = { ...completeMap(), status: 'Approved' as const };
    writeFileSync('docs/features/payments-map.md', markdown(approved));
    expect(guard.check({ filePath: 'src/payment.ts', content: 'export {}' }).recommendation).toBe('PROCEED');
    expect(guard.check({ filePath: 'README.md', content: 'docs change' }).recommendation).toBe('PROCEED');
  });

  it('runs map, chaos, and verify through the source CLI', () => {
    const root = `${originalCwd}/${TMP}`;
    execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'deliver', 'map', '--feature', 'payments', '--dir', root], { cwd: originalCwd });
    const path = join(TMP, 'docs/features/payments-map.md');
    writeFileSync(path, markdown(completeMap()));
    mkdirSync(join(TMP, 'src'), { recursive: true });
    writeFileSync(join(TMP, 'src/payment.ts'), "logger.warn({ seam: 'gateway' }); // seam:gateway\n");
    const chaos = execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'deliver', 'chaos', '--map', 'docs/features/payments-map.md', '--dir', root], { cwd: originalCwd, encoding: 'utf8' });
    expect(JSON.parse(chaos)).toHaveLength(5);
    const verify = execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'deliver', 'verify', '--map', 'docs/features/payments-map.md', '--dir', root], { cwd: originalCwd, encoding: 'utf8' });
    expect(verify).toContain('appended verified delivery handoff');
    expect(readFileSync(join(TMP, 'docs/state/active_session.md'), 'utf8')).toContain('Feature: payments');
  });
});
