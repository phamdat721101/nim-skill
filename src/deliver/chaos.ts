import { EDGE_IDS, type SystemMap, type ThreatVector } from './types.js';

const DEFINITION: Array<[string, string]> = [
  ['network_drop', 'Transport drops during payload transmission'],
  ['timeout', 'A downstream dependency exceeds its response deadline'],
  ['state_desync', 'Concurrent calls mutate the same state'],
  ['boundary_input', 'Input is malformed, empty, or oversized'],
  ['rollback_failure', 'A later step fails after an earlier mutation'],
];

export function generateThreatMatrix(map: SystemMap): ThreatVector[] {
  if (map.seams.length === 0) throw new Error('nim: System Map needs at least one declared seam before generating chaos threats');
  return EDGE_IDS.map((edgeId, index) => {
    const [category, scenario] = DEFINITION[index]!;
    return { edgeId, category, scenario, seamId: map.seams[index % map.seams.length]!.id };
  });
}
