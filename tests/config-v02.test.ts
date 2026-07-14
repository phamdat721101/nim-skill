import { describe, it, expect } from 'vitest';
import { resolveConfig } from '../src/config.js';

describe('resolveConfig — new v0.2/v0.3 layers', () => {
  it('leaves every new layer null when absent (byte-identical passthrough)', () => {
    const r = resolveConfig({});
    expect(r.context).toBeNull();
    expect(r.memory).toBeNull();
    expect(r.execution).toBeNull();
    expect(r.cache).toBeNull();
  });

  it('treats explicit false as disabled', () => {
    const r = resolveConfig({ context: false, memory: false, execution: false, cache: false });
    expect(r.context).toBeNull();
    expect(r.memory).toBeNull();
    expect(r.execution).toBeNull();
    expect(r.cache).toBeNull();
  });

  it('fills context defaults', () => {
    const r = resolveConfig({ context: { maxInputTokens: 8000 } });
    expect(r.context).toEqual({ progressive: true, maxInputTokens: 8000, onExceed: 'warn', lean: false });
  });

  it('fills cache defaults with per-provider min-token floor (glm=512, else 1024)', () => {
    expect(resolveConfig({ cache: { provider: 'glm' } }).cache?.minTokens).toBe(512);
    expect(resolveConfig({ cache: { provider: 'openai' } }).cache?.minTokens).toBe(1024);
    expect(resolveConfig({ cache: {} }).cache?.provider).toBe('auto');
    expect(resolveConfig({ cache: {} }).cache?.strategy).toBe('prefix');
    expect(resolveConfig({ cache: {} }).cache?.breakEvenReads).toBe(2);
  });

  it('resolves enforcer.healFeedback and monitor.tokenAccounting defaults', () => {
    expect(resolveConfig({ enforcer: {} }).enforcer?.healFeedback).toBe('full');
    expect(resolveConfig({ enforcer: { healFeedback: 'minimal' } }).enforcer?.healFeedback).toBe('minimal');
    expect(resolveConfig({ monitor: {} }).monitor?.tokenAccounting).toBe(false);
    expect(resolveConfig({ monitor: { tokenAccounting: true } }).monitor?.tokenAccounting).toBe(true);
  });
});
