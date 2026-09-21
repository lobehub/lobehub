import type { AcceptanceFlowVerdict } from '@lobechat/types';

/** A node passes only when every required incoming branch (and entry) passes. */
export function getFlowNodeState(
  nodeKey: string,
  entryNodeKey: string,
  edges: { id: string; targetNodeKey: string; required: boolean }[],
  visits: { incomingEdgeId: string | null; verdict: AcceptanceFlowVerdict }[],
  entryRequired = true,
): AcceptanceFlowVerdict | 'partial' | undefined {
  const latest = new Map(visits.map((attempt) => [attempt.incomingEdgeId ?? 'entry', attempt]));
  const targets = edges
    .filter((edge) => edge.targetNodeKey === nodeKey && (edge.required || latest.has(edge.id)))
    .map((edge) => edge.id);
  if (nodeKey === entryNodeKey && (entryRequired || latest.has('entry'))) targets.push('entry');
  const states = targets.map((key) => latest.get(key)?.verdict);
  if (states.includes('failed')) return 'failed';
  if (states.includes('blocked')) return 'blocked';
  if (states.includes('uncertain')) return 'uncertain';
  if (states.length > 0 && states.every((state) => state === 'passed')) return 'passed';
  if (states.some(Boolean)) return 'partial';
  return undefined;
}
