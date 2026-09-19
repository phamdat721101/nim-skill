/**
 * src/search/graph.ts
 * --------------------
 * In-memory relational context graph. `traverseGraph()` is a BFS with a
 * visited-Set guard (never revisits a node id, so a cycle terminates rather
 * than looping forever) and a hard depth cap of 3 (any larger request is
 * clamped down, never honored as-is).
 */

import type { GraphEdge, GraphNode, GraphRelationship } from './graph-sources/types.js';

const MAX_DEPTH = 3;

export interface TraversalHit {
  target_node_id: string;
  target_type: string;
  target_uri: string;
  relationship: string;
  summary: string;
  confidence_weight: number;
}

export class ContextGraph {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edgesBySource = new Map<string, GraphEdge[]>();

  addNodes(nodes: GraphNode[]): void {
    for (const node of nodes) this.nodes.set(node.id, node);
  }

  addEdges(edges: GraphEdge[]): void {
    for (const edge of edges) {
      const list = this.edgesBySource.get(edge.sourceId) ?? [];
      list.push(edge);
      this.edgesBySource.set(edge.sourceId, list);
    }
  }

  /**
   * BFS from `originNodeId`, following only edges matching `relationshipType`.
   * `maxDepth` is clamped to at most 3. A visited-Set guard guarantees
   * termination and no duplicate targets, even in the presence of a cycle.
   */
  traverseGraph(originNodeId: string, relationshipType: GraphRelationship, maxDepth = 1): TraversalHit[] {
    const depthLimit = Math.min(Math.max(maxDepth, 0), MAX_DEPTH);
    const visited = new Set<string>([originNodeId]);
    const results: TraversalHit[] = [];

    let frontier = [originNodeId];
    for (let depth = 0; depth < depthLimit && frontier.length > 0; depth++) {
      const nextFrontier: string[] = [];
      for (const currentId of frontier) {
        const edges = this.edgesBySource.get(currentId) ?? [];
        for (const edge of edges) {
          if (edge.relationship !== relationshipType) continue;
          if (visited.has(edge.targetId)) continue;
          visited.add(edge.targetId);

          const targetNode = this.nodes.get(edge.targetId);
          results.push({
            target_node_id: edge.targetId,
            target_type: targetNode?.type ?? 'Unknown',
            target_uri: targetNode?.uri ?? '',
            relationship: edge.relationship,
            summary: targetNode ? `${targetNode.type} ${targetNode.name}` : edge.targetId,
            confidence_weight: edge.metadata?.confidence ?? 1,
          });
          nextFrontier.push(edge.targetId);
        }
      }
      frontier = nextFrontier;
    }

    return results;
  }
}
