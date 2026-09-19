import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { JiraSource } from '../src/search/graph-sources/jira-source.js';
import { SlackSource } from '../src/search/graph-sources/slack-source.js';
import { GitHubSource } from '../src/search/graph-sources/github-source.js';
import { McpSource } from '../src/search/graph-sources/mcp-source.js';
import { GitSource } from '../src/search/graph-sources/git-source.js';
import { resolveConfig } from '../src/config.js';

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('JiraSource', () => {
  it('is disabled by default, no network call, reasoned', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const source = new JiraSource({ enabled: false, baseUrlEnv: 'NIM_SEARCH_JIRA_BASE_URL', tokenEnv: 'NIM_SEARCH_JIRA_TOKEN' });
    const result = await source.ingest();
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.disabledReason).toMatch(/enable/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('enabled but token env unset returns reasoned empty result, no fetch call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    delete process.env.NIM_SEARCH_JIRA_TOKEN;
    const source = new JiraSource({ enabled: true, baseUrlEnv: 'NIM_SEARCH_JIRA_BASE_URL', tokenEnv: 'NIM_SEARCH_JIRA_TOKEN' });
    const result = await source.ingest();
    expect(result.nodes).toEqual([]);
    expect(result.disabledReason).toMatch(/credential/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('enabled + token set + mocked fetch produces correctly-shaped JiraIssue nodes', async () => {
    process.env.NIM_SEARCH_JIRA_TOKEN = 'secret-token';
    process.env.NIM_SEARCH_JIRA_BASE_URL = 'https://example.atlassian.net';
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        issues: [
          { key: 'PROJ-1', fields: { summary: 'Fix the thing', updated: '2026-01-01T00:00:00.000Z' } },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const source = new JiraSource({ enabled: true, baseUrlEnv: 'NIM_SEARCH_JIRA_BASE_URL', tokenEnv: 'NIM_SEARCH_JIRA_TOKEN' });
    const result = await source.ingest();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.disabledReason).toBeUndefined();
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.type).toBe('JiraIssue');
    expect(result.nodes[0]?.name).toContain('PROJ-1');
  });

  it('wraps a fetch failure in a disabledReason instead of throwing', async () => {
    process.env.NIM_SEARCH_JIRA_TOKEN = 'secret-token';
    process.env.NIM_SEARCH_JIRA_BASE_URL = 'https://example.atlassian.net';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const source = new JiraSource({ enabled: true, baseUrlEnv: 'NIM_SEARCH_JIRA_BASE_URL', tokenEnv: 'NIM_SEARCH_JIRA_TOKEN' });
    const result = await expect(source.ingest()).resolves.toBeDefined();
    void result;
    const r = await source.ingest();
    expect(r.nodes).toEqual([]);
    expect(r.disabledReason).toMatch(/request failed/i);
  });
});

describe('SlackSource', () => {
  it('is disabled by default, no network call, reasoned', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const source = new SlackSource({ enabled: false, tokenEnv: 'NIM_SEARCH_SLACK_TOKEN' });
    const result = await source.ingest();
    expect(result.nodes).toEqual([]);
    expect(result.disabledReason).toMatch(/enable/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('enabled but token env unset returns reasoned empty result, no fetch call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    delete process.env.NIM_SEARCH_SLACK_TOKEN;
    const source = new SlackSource({ enabled: true, tokenEnv: 'NIM_SEARCH_SLACK_TOKEN' });
    const result = await source.ingest();
    expect(result.nodes).toEqual([]);
    expect(result.disabledReason).toMatch(/credential/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('enabled + token set + mocked fetch produces correctly-shaped SlackDiscussion nodes', async () => {
    process.env.NIM_SEARCH_SLACK_TOKEN = 'xoxb-secret';
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        messages: [{ ts: '1700000000.000100', user: 'U123', text: 'discussing the payment rail crash' }],
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const source = new SlackSource({ enabled: true, tokenEnv: 'NIM_SEARCH_SLACK_TOKEN' });
    const result = await source.ingest();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.disabledReason).toBeUndefined();
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.type).toBe('SlackDiscussion');
  });

  it('wraps a fetch failure in a disabledReason instead of throwing', async () => {
    process.env.NIM_SEARCH_SLACK_TOKEN = 'xoxb-secret';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    const source = new SlackSource({ enabled: true, tokenEnv: 'NIM_SEARCH_SLACK_TOKEN' });
    const r = await source.ingest();
    expect(r.nodes).toEqual([]);
    expect(r.disabledReason).toMatch(/request failed/i);
  });
});

describe('GitHubSource', () => {
  it('is disabled by default, no network call, reasoned', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const source = new GitHubSource({ enabled: false, tokenEnv: 'NIM_SEARCH_GITHUB_TOKEN' });
    const result = await source.ingest();
    expect(result.nodes).toEqual([]);
    expect(result.disabledReason).toMatch(/enable/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('enabled but token env unset returns reasoned empty result, no fetch call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    delete process.env.NIM_SEARCH_GITHUB_TOKEN;
    const source = new GitHubSource({ enabled: true, tokenEnv: 'NIM_SEARCH_GITHUB_TOKEN' });
    const result = await source.ingest();
    expect(result.nodes).toEqual([]);
    expect(result.disabledReason).toMatch(/credential/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('enabled + token set + mocked fetch produces correctly-shaped PR nodes', async () => {
    process.env.NIM_SEARCH_GITHUB_TOKEN = 'ghp_secret';
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([
        { number: 42, title: 'Fix payment rail', html_url: 'https://github.com/org/repo/pull/42', updated_at: '2026-01-01T00:00:00Z', user: { login: 'octocat' } },
      ]),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const source = new GitHubSource({ enabled: true, tokenEnv: 'NIM_SEARCH_GITHUB_TOKEN' });
    const result = await source.ingest();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.disabledReason).toBeUndefined();
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.type).toBe('PR');
    expect(result.nodes[0]?.uri).toBe('https://github.com/org/repo/pull/42');
  });

  it('wraps a fetch failure in a disabledReason instead of throwing', async () => {
    process.env.NIM_SEARCH_GITHUB_TOKEN = 'ghp_secret';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('DNS failure')));
    const source = new GitHubSource({ enabled: true, tokenEnv: 'NIM_SEARCH_GITHUB_TOKEN' });
    const r = await source.ingest();
    expect(r.nodes).toEqual([]);
    expect(r.disabledReason).toMatch(/request failed/i);
  });
});

describe('McpSource', () => {
  it('disabled/no serverName returns reasoned empty result, injected call function never invoked', async () => {
    const callFn = vi.fn();
    const source = new McpSource({ enabled: false, serverName: null }, callFn);
    const result = await source.ingest();
    expect(result.nodes).toEqual([]);
    expect(result.disabledReason).toBeDefined();
    expect(callFn).not.toHaveBeenCalled();
  });

  it('enabled but serverName null still no-ops with a reason', async () => {
    const callFn = vi.fn();
    const source = new McpSource({ enabled: true, serverName: null }, callFn);
    const result = await source.ingest();
    expect(result.nodes).toEqual([]);
    expect(callFn).not.toHaveBeenCalled();
  });

  it('enabled + serverName + mock call function produces correctly-shaped results', async () => {
    const callFn = vi.fn().mockResolvedValue({
      nodes: [{ id: 'x::1', type: 'JiraIssue', name: 'Issue 1', uri: 'mcp://x/1', digestSha256: 'a'.repeat(64), lastModified: new Date().toISOString() }],
      edges: [],
    });
    const source = new McpSource({ enabled: true, serverName: 'some-mcp-server' }, callFn);
    const result = await source.ingest();
    expect(callFn).toHaveBeenCalledWith('some-mcp-server', expect.any(String), expect.anything());
    expect(result.nodes).toHaveLength(1);
    expect(result.disabledReason).toBeUndefined();
  });
});

describe('full-graph-build with all extended sources at config defaults', () => {
  it('only git-source contributes nodes when jira/slack/github/mcp are left disabled', async () => {
    delete process.env.NIM_SEARCH_JIRA_TOKEN;
    delete process.env.NIM_SEARCH_SLACK_TOKEN;
    delete process.env.NIM_SEARCH_GITHUB_TOKEN;

    const resolved = resolveConfig({}); // defaults — graph config not part of harness resolveConfig directly, but exercise the sources directly with defaults
    void resolved;

    const sources = [
      new GitSource(process.cwd()),
      new JiraSource({ enabled: false }),
      new SlackSource({ enabled: false }),
      new GitHubSource({ enabled: false }),
      new McpSource({ enabled: false, serverName: null }, vi.fn()),
    ];

    const results = await Promise.all(sources.map((s) => s.ingest()));
    const allNodes = results.flatMap((r) => r.nodes);
    const allTypes = new Set(allNodes.map((n) => n.type));

    // git-derived types only: CodeFile, PR (commit-derived), Author.
    for (const type of allTypes) {
      expect(['CodeFile', 'PR', 'Author']).toContain(type);
    }
    expect(allNodes.length).toBeGreaterThan(0); // git-source genuinely ran against this repo
  });
});
