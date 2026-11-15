import type { AcceptanceCheck, AcceptanceEvidence } from '../Checks/types';
import { IMAGE_EVIDENCE } from './evidence';

export type ResourceKind = 'other' | 'recording' | 'screenshot';
export type ResourceFilter = 'all' | ResourceKind;

export const RESOURCE_FILTERS: ResourceFilter[] = ['all', 'screenshot', 'recording', 'other'];

const RECORDING_EVIDENCE = new Set(['audio', 'video']);

export const resourceKind = (
  evidence: Pick<AcceptanceEvidence, 'fileUrl' | 'type'>,
): ResourceKind => {
  if (!evidence.fileUrl) return 'other';
  if (IMAGE_EVIDENCE.has(evidence.type)) return 'screenshot';
  if (RECORDING_EVIDENCE.has(evidence.type)) return 'recording';
  return 'other';
};

export interface ResourceItem {
  checkSeq: number;
  checkTitle: string;
  evidence: AcceptanceEvidence;
  key: string;
  kind: ResourceKind;
  roundIndex: number | null;
  rounds: number[];
}

const resourceKey = (evidence: AcceptanceEvidence) =>
  evidence.fileId ?? evidence.documentId ?? evidence.id;

export const collectResources = (checks: AcceptanceCheck[]): ResourceItem[] => {
  const byKey = new Map<string, ResourceItem>();
  const add = (check: AcceptanceCheck, evidence: AcceptanceEvidence, roundIndex: number | null) => {
    if (!evidence.fileUrl && !evidence.documentId) return;
    const key = resourceKey(evidence);
    if (!key) return;
    const known = byKey.get(key);
    if (known) {
      if (roundIndex !== null && !known.rounds.includes(roundIndex)) known.rounds.push(roundIndex);
      return;
    }
    byKey.set(key, {
      checkSeq: check.seq,
      checkTitle: check.title,
      evidence,
      key,
      kind: resourceKind(evidence),
      roundIndex,
      rounds: roundIndex === null ? [] : [roundIndex],
    });
  };

  for (const check of checks) {
    const steps = [...(check.timeline ?? [])].sort((a, b) => a.roundIndex - b.roundIndex);
    for (const step of steps) for (const item of step.evidence) add(check, item, step.roundIndex);
    for (const item of check.evidence ?? []) add(check, item, check.resultRound ?? null);
  }

  return [...byKey.values()].sort(
    (a, b) => (b.roundIndex ?? -1) - (a.roundIndex ?? -1) || a.checkSeq - b.checkSeq,
  );
};

export const filterResources = (
  items: ResourceItem[],
  { kind, round }: { kind: ResourceFilter; round: number | null },
) =>
  items.filter(
    (item) =>
      (kind === 'all' || item.kind === kind) && (round === null || item.rounds.includes(round)),
  );

export const countResources = (items: ResourceItem[]): Record<ResourceFilter, number> => {
  const counts = { all: items.length, other: 0, recording: 0, screenshot: 0 };
  for (const item of items) counts[item.kind] += 1;
  return counts;
};
