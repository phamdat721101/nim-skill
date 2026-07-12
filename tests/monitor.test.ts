import { describe, it, expect, vi, afterEach } from 'vitest';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { createMonitor } from '../src/monitor/capture.js';
import type { EventSink } from '../src/monitor/capture.js';
import { wrap, buildTrace, newTraceId } from '../src/monitor/wrap.js';
import { renderDashboard, summarize, parseTraces } from '../src/monitor/dashboard.js';
import type { TraceRecord } from '../src/harness/types.js';

const TMP = '.nim-test/traces.jsonl';

afterEach(() => {
  rmSync('.nim-test', { recursive: true, force: true });
});

const flush = () => new Promise((r) => setTimeout(r, 5));

function trace(over: Partial<TraceRecord> = {}): TraceRecord {
  return { skill: 's', traceId: newTraceId(), startedAt: new Date().toISOString(), durationMs: 1, status: 'success', ...over };
}

describe('createMonitor', () => {
  it('disabled monitor (null cfg) is a no-op with no sinks', () => {
    const m = createMonitor(null);
    expect(m.sinks).toHaveLength(0);
    expect(() => m.capture(trace())).not.toThrow();
  });

  it('fans out to configured sinks (non-blocking)', async () => {
    const seen: TraceRecord[] = [];
    const fake: EventSink = { name: 'fake', emit: (t) => void seen.push(t) };
    const m = createMonitor({ exporters: ['console'], traceFile: TMP });
    (m as unknown as { sinks: EventSink[] }).sinks.splice(0, m.sinks.length, fake);
    m.capture(trace({ skill: 'x' }));
    await flush();
    expect(seen[0]?.skill).toBe('x');
  });

  it('a throwing sink never breaks capture (sink-liveness)', async () => {
    const boom: EventSink = { name: 'boom', emit: () => { throw new Error('nope'); } };
    const m = createMonitor({ exporters: [], traceFile: TMP });
    (m as unknown as { sinks: EventSink[] }).sinks.push(boom);
    expect(() => m.capture(trace())).not.toThrow();
    await flush();
  });

  it('file sink writes JSONL', async () => {
    const m = createMonitor({ exporters: ['file'], traceFile: TMP });
    m.capture(trace({ skill: 'file-test' }));
    await flush();
    expect(existsSync(TMP)).toBe(true);
    expect(readFileSync(TMP, 'utf8')).toMatch(/file-test/);
  });
});

describe('wrap', () => {
  it('returns the value and captures a success trace', async () => {
    const m = createMonitor({ exporters: [], traceFile: TMP });
    const cap = vi.spyOn(m, 'capture');
    const v = await wrap(m, 'ok', () => 42);
    expect(v).toBe(42);
    expect(cap).toHaveBeenCalledWith(expect.objectContaining({ status: 'success' }));
  });

  it('captures an error trace then rethrows', async () => {
    const m = createMonitor({ exporters: [], traceFile: TMP });
    const cap = vi.spyOn(m, 'capture');
    await expect(wrap(m, 'bad', () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(cap).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
  });
});

describe('buildTrace', () => {
  it('omits undefined optional fields', () => {
    const t = buildTrace({ skill: 's', traceId: 'id', startedAt: Date.now() }, { status: 'success', durationMs: 3 });
    expect(t).not.toHaveProperty('errorClass');
    expect(t.verifyPassed).toBeUndefined();
  });
});

describe('dashboard', () => {
  it('summarizes traces with verify pass-rate and heal totals', () => {
    const traces = [
      trace({ status: 'success', verifyPassed: true, healCount: 1, durationMs: 10 }),
      trace({ status: 'error', errorClass: 'transient', verifyPassed: false, durationMs: 20 }),
    ];
    const out = summarize(traces);
    expect(out).toMatch(/2 run/);
    expect(out).toMatch(/transient=1/);
    expect(out).toMatch(/50% pass/);
    expect(out).toMatch(/heals:\s+1/);
  });

  it('parseTraces skips malformed lines', () => {
    expect(parseTraces('{bad}\n' + JSON.stringify(trace()) + '\n')).toHaveLength(1);
  });

  it('renderDashboard reports a missing file gracefully', () => {
    expect(renderDashboard('.nim-test/none.jsonl')).toMatch(/no trace file/);
  });

  it('summarize handles empty input', () => {
    expect(summarize([])).toMatch(/no traces/);
  });
});
