import type { SystemMap, SystemMapStatus } from './types.js';

const OPEN = '```json nim-deliver';
const CLOSE = '```';

export function systemMapPath(featureId: string, dir = 'docs/features'): string {
  const safe = featureId.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!safe) throw new Error('nim: feature id must contain letters or numbers');
  return `${dir}/${safe}-map.md`;
}

export function systemMapTemplate(featureId: string, taskType: SystemMap['taskType'] = 'feature'): string {
  const map: SystemMap = {
    featureId, taskType, status: 'Draft',
    input: { entrypoint: 'REVIEW REQUIRED', payload: 'REVIEW REQUIRED' },
    processing: { apiHops: [], datastores: [], services: [] },
    output: { state: 'REVIEW REQUIRED', transitions: [] }, seams: [], edgeProofs: [],
  };
  return `# System Map: ${featureId}\n\n${OPEN}\n${JSON.stringify(map, null, 2)}\n${CLOSE}\n\n## Input Flow\n\nDescribe the entrypoint and typed payload.\n\n## Processing Pipeline\n\nDeclare APIs, data stores, and external services.\n\n## Output State\n\nDeclare state transitions and failure states.\n`;
}

export function parseSystemMap(markdown: string): SystemMap {
  const start = markdown.indexOf(OPEN);
  if (start < 0) throw new Error('nim: System Map requires a fenced `json nim-deliver` metadata block');
  const bodyStart = start + OPEN.length;
  const end = markdown.indexOf(CLOSE, bodyStart);
  if (end < 0) throw new Error('nim: System Map metadata block is not closed');
  let raw: unknown;
  try { raw = JSON.parse(markdown.slice(bodyStart, end).trim()); } catch { throw new Error('nim: System Map metadata is not valid JSON'); }
  return validateSystemMap(raw);
}

export function validateSystemMap(raw: unknown): SystemMap {
  if (!raw || typeof raw !== 'object') throw new Error('nim: System Map metadata must be an object');
  const map = raw as Partial<SystemMap>;
  const statuses: SystemMapStatus[] = ['Draft', 'Approved', 'Implementing', 'Done'];
  if (!map.featureId?.trim()) throw new Error('nim: System Map featureId is required');
  if (map.taskType !== 'feature' && map.taskType !== 'patch') throw new Error('nim: System Map taskType must be feature or patch');
  if (!statuses.includes(map.status as SystemMapStatus)) throw new Error('nim: System Map status is invalid');
  if (!map.input?.entrypoint?.trim() || !map.input.payload?.trim()) throw new Error('nim: System Map input entrypoint and payload are required');
  if (!map.processing || !Array.isArray(map.processing.apiHops) || !Array.isArray(map.processing.datastores) || !Array.isArray(map.processing.services)) throw new Error('nim: System Map processing arrays are required');
  if (!map.output?.state?.trim() || !Array.isArray(map.output.transitions)) throw new Error('nim: System Map output state and transitions are required');
  if (!Array.isArray(map.seams) || map.seams.some((s) => !s?.id?.trim() || !s.description?.trim())) throw new Error('nim: System Map seams require id and description');
  if (new Set(map.seams.map((s) => s.id)).size !== map.seams.length) throw new Error('nim: System Map seam ids must be unique');
  if (!Array.isArray(map.edgeProofs)) throw new Error('nim: System Map edgeProofs must be an array');
  if (map.status !== 'Draft' && (map.processing.apiHops.length + map.processing.datastores.length + map.processing.services.length === 0 || map.output.transitions.length === 0 || map.seams.length === 0)) {
    throw new Error('nim: approved System Maps require processing boundaries, state transitions, and at least one seam');
  }
  return map as SystemMap;
}
