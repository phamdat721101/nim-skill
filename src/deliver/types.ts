import type { CheckResult } from '../harness/types.js';

export const EDGE_IDS = ['EDGE-01', 'EDGE-02', 'EDGE-03', 'EDGE-04', 'EDGE-05'] as const;
export type EdgeId = typeof EDGE_IDS[number];
export type SystemMapStatus = 'Draft' | 'Approved' | 'Implementing' | 'Done';
export type DeliveryTaskType = 'feature' | 'patch';

export interface DeliverySeam { id: string; description: string; }
export interface EdgeProof { edgeId: EdgeId; seamId: string; command: string; logMarker: string; sourceFiles: string[]; }
export interface SystemMap {
  featureId: string;
  taskType: DeliveryTaskType;
  status: SystemMapStatus;
  input: { entrypoint: string; payload: string };
  processing: { apiHops: string[]; datastores: string[]; services: string[] };
  output: { state: string; transitions: string[] };
  seams: DeliverySeam[];
  edgeProofs: EdgeProof[];
}

export interface ThreatVector { edgeId: EdgeId; category: string; scenario: string; seamId: string; }
export interface DeliveryVerifyReport { passed: boolean; checks: CheckResult[]; }
