import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkEnvironmentContract, deliveryBriefTemplate, runDeliveryCheck, type DeliveryConfig } from '../src/deliver/index.js';

const TMP = '.nim-deliver-test';
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

function setup(): DeliveryConfig {
  mkdirSync(join(TMP, 'docs/features'), { recursive: true });
  mkdirSync(join(TMP, 'config'), { recursive: true });
  writeFileSync(join(TMP, 'docs/features/payments.md'), deliveryBriefTemplate('Payments'));
  writeFileSync(join(TMP, 'config/application-qa.yml'), 'redis-password: ${APP_REDIS_PASSWORD:}\n');
  writeFileSync(join(TMP, 'contract.json'), JSON.stringify({
    secrets: [{ key: 'APP_REDIS_PASSWORD', binding: 'app.redis.password' }],
    tls: [{ host: 'redis.cache.amazonaws.com', ssl: true, verification: 'provider-endpoint' }],
    collateral: [],
  }));
  return { mode: 'strict', briefDir: 'docs/features', requireWorkrule: true, profiles: { qa: { contract: 'contract.json', configFiles: ['config/application-qa.yml'], commands: ['true'] } } };
}

describe('delivery contracts', () => {
  it('passes a complete pre-delivery contract and records every matrix item', () => {
    const report = runDeliveryCheck(TMP, setup(), 'qa', 'pre', () => ({ ok: true }), true);
    expect(report.passed).toBe(true);
    expect(report.checks).toHaveLength(6);
  });

  it('rejects missing explicit secret placeholders and disabled TLS verification', () => {
    const cfg = setup();
    writeFileSync(join(TMP, 'contract.json'), JSON.stringify({
      secrets: [{ key: 'MISSING', binding: 'app.missing' }],
      tls: [{ host: 'redis.qa.example.com', ssl: true, verification: 'disabled' }],
      collateral: [],
    }));
    const report = runDeliveryCheck(TMP, cfg, 'qa', 'pre', () => ({ ok: true }), true);
    expect(report.passed).toBe(false);
    expect(report.checks.find((item) => item.strategy === 'DELIVER-03 TLS transport')?.reason).toMatch(/hostname verification/);
    expect(checkEnvironmentContract(TMP, 'contract.json', ['config/application-qa.yml']).pass).toBe(false);
  });

  it('requires independent post-delivery evidence', () => {
    const cfg = setup();
    let report = runDeliveryCheck(TMP, cfg, 'qa', 'post', () => ({ ok: true }), true);
    expect(report.passed).toBe(false);
    mkdirSync(join(TMP, '.nim/deliver'), { recursive: true });
    writeFileSync(join(TMP, '.nim/deliver/qa-evidence.json'), JSON.stringify({
      source: 'qa deployment record', buildId: 'abc123', target: 'qa', timestamp: '2026-08-21T00:00:00Z', health: 'healthy', clientAcceptance: 'accepted',
    }));
    report = runDeliveryCheck(TMP, cfg, 'qa', 'post', () => ({ ok: true }), true);
    expect(report.passed).toBe(true);
  });
});
