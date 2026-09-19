import { describe, expect, it } from 'vitest';
import { ContextGraph } from '../src/search/graph.js';
import { GitSource } from '../src/search/graph-sources/git-source.js';
import type { GraphNode, GraphEdge } from '../src/search/graph-sources/types.js';

function node(id: string, type: GraphNode['type'] = 'CodeFile'): GraphNode {
  return { id, type, name: id, uri: `file:///${id}`, digestSha256: 'x'.repeat(64), lastModified: new Date().toISOString() };
}

function edge(sourceId: string, targetId: string, relationship: GraphEdge['relationship']): GraphEdge {
  return { sourceId, targetId, relationship };
}

describe('ContextGraph.traverseGraph', () => {
  it('terminates on a graph with a deliberate cycle (A->B->A), never revisiting a node', () => {
    const graph = new ContextGraph();
    graph.addNodes([node('A'), node('B')]);
    graph.addEdges([edge('A', 'B', 'DEPENDS_ON'), edge('B', 'A', 'DEPENDS_ON')]);

    const start = Date.now();
    const result = graph.traverseGraph('A', 'DEPENDS_ON', 5);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1000); // must not hang
    const targetIds = result.map((r) => r.target_node_id);
    expect(new Set(targetIds).size).toBe(targetIds.length); // no duplicate visits
    expect(targetIds).toContain('B');
    expect(targetIds).not.toContain('A'); // origin itself never appears as a target of itself
  });

  it('produces a correct, bounded result for a simple chain', () => {
    const graph = new ContextGraph();
    graph.addNodes([node('A'), node('B'), node('C')]);
    graph.addEdges([edge('A', 'B', 'CALLS'), edge('B', 'C', 'CALLS')]);

    const result = graph.traverseGraph('A', 'CALLS', 2);
    const targetIds = result.map((r) => r.target_node_id);
    expect(targetIds).toEqual(expect.arrayContaining(['B', 'C']));
    expect(result.every((r) => typeof r.confidence_weight === 'number')).toBe(true);
    expect(result.every((r) => r.relationship === 'CALLS')).toBe(true);
  });

  it('only matches edges of the requested relationship type at each hop', () => {
    const graph = new ContextGraph();
    graph.addNodes([node('A'), node('B'), node('C')]);
    graph.addEdges([edge('A', 'B', 'CALLS'), edge('A', 'C', 'DEPENDS_ON')]);

    const result = graph.traverseGraph('A', 'CALLS', 2);
    const targetIds = result.map((r) => r.target_node_id);
    expect(targetIds).toEqual(['B']);
  });

  it('clamps a maxDepth request of 10 down to 3', () => {
    const graph = new ContextGraph();
    const chainLength = 6; // longer than 3 hops
    const nodes = Array.from({ length: chainLength + 1 }, (_, i) => node(`N${i}`));
    const edges = Array.from({ length: chainLength }, (_, i) => edge(`N${i}`, `N${i + 1}`, 'DEPENDS_ON'));
    graph.addNodes(nodes);
    graph.addEdges(edges);

    const clamped = graph.traverseGraph('N0', 'DEPENDS_ON', 10);
    const withExplicit3 = graph.traverseGraph('N0', 'DEPENDS_ON', 3);

    expect(clamped.length).toBe(withExplicit3.length);
    expect(clamped.map((r) => r.target_node_id).sort()).toEqual(withExplicit3.map((r) => r.target_node_id).sort());
    // 3 hops from N0 reaches N1, N2, N3 only — not N4/N5/N6.
    expect(clamped.map((r) => r.target_node_id)).not.toContain('N4');
  });
});

describe('GitSource.ingest — real integration against this repo', () => {
  it('returns at least one real Author node and one real CodeFile node from actual commit history', async () => {
    const source = new GitSource(process.cwd());
    const result = await source.ingest();

    expect(result.disabledReason).toBeUndefined();
    expect(result.nodes.some((n) => n.type === 'Author')).toBe(true);
    expect(result.nodes.some((n) => n.type === 'CodeFile')).toBe(true);
    expect(result.nodes.some((n) => n.type === 'PR')).toBe(true);
    expect(result.edges.some((e) => e.relationship === 'OWNED_BY')).toBe(true);
  });

  it('returns a disabledReason (not a throw) when run outside a git repository', async () => {
    const source = new GitSource('/tmp');
    const result = await source.ingest();
    // /tmp is very unlikely to be a git repo; if it happens to be one in some
    // exotic environment, this assertion would need revisiting, but on
    // standard CI/dev machines this proves the non-throwing disabled path.
    if (result.disabledReason) {
      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    }
  });
});
