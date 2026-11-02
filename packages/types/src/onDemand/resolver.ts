import type {
  OnDemandDynamicEntry,
  OnDemandDynamicFloor,
  OnDemandDynamicKind,
  OnDemandResolvedEntryClass,
} from './types';
import { ON_DEMAND_BOOTSTRAP_ALLOWLIST, ON_DEMAND_DYNAMIC_KINDS } from './types';

/**
 * Lower rank wins when two entries otherwise have equal priority/relevance.
 * The order is part of the deterministic protocol contract.
 */
export const ON_DEMAND_KIND_ORDER = [
  'safety',
  'pending_action',
  'tool_contract',
  'explicit_constraint',
  'preference',
  'approved_expertise',
  'memory',
  'environment',
  'skill_card',
  'document_card',
  'tool_card',
  'unapproved_suggestion',
] as const satisfies readonly OnDemandDynamicKind[];

export const ON_DEMAND_KIND_RANK: Readonly<Record<OnDemandDynamicKind, number>> = Object.freeze(
  Object.fromEntries(ON_DEMAND_KIND_ORDER.map((kind, index) => [kind, index])) as Record<
    OnDemandDynamicKind,
    number
  >,
);

const HARD_FLOOR_BY_KIND: Partial<Record<OnDemandDynamicKind, OnDemandDynamicFloor>> = {
  pending_action: 'pending_action',
  safety: 'safety',
  tool_contract: 'active_tool_contract',
};

export const isOnDemandFloorValidForKind = (
  kind: OnDemandDynamicKind,
  floor: OnDemandDynamicFloor,
): boolean => HARD_FLOOR_BY_KIND[kind] === floor;

export const resolveOnDemandEntryFloor = (
  entry: Pick<OnDemandDynamicEntry, 'floor' | 'kind'>,
): OnDemandDynamicFloor | undefined => HARD_FLOOR_BY_KIND[entry.kind] ?? entry.floor;

export const isOnDemandHardFloorEntry = (
  entry: Pick<OnDemandDynamicEntry, 'floor' | 'kind'>,
): boolean => resolveOnDemandEntryFloor(entry) !== undefined;

export const resolveOnDemandEntryClass = (
  entry: Pick<OnDemandDynamicEntry, 'floor' | 'kind' | 'required'>,
): OnDemandResolvedEntryClass =>
  entry.required || isOnDemandHardFloorEntry(entry) ? 'protected' : 'degradable';

export const isOnDemandBootstrapApiAllowed = (identifier: string, apiName: string): boolean => {
  const allowedApis: readonly string[] | undefined =
    ON_DEMAND_BOOTSTRAP_ALLOWLIST[identifier as keyof typeof ON_DEMAND_BOOTSTRAP_ALLOWLIST];

  return allowedApis?.includes(apiName) === true;
};

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Deterministic priority ordering. Protected entries always sort first, then
 * explicit priority/relevance, then stable content-derived tie breakers.
 */
export const compareOnDemandDynamicEntries = (
  a: OnDemandDynamicEntry,
  b: OnDemandDynamicEntry,
): number => {
  const classDelta =
    Number(resolveOnDemandEntryClass(b) === 'protected') -
    Number(resolveOnDemandEntryClass(a) === 'protected');
  if (classDelta !== 0) return classDelta;

  const floorDelta =
    (resolveOnDemandEntryFloor(a) === undefined ? 1 : 0) -
    (resolveOnDemandEntryFloor(b) === undefined ? 1 : 0);
  if (floorDelta !== 0) return floorDelta;

  const priorityDelta = b.priority - a.priority;
  if (priorityDelta !== 0) return priorityDelta;

  const relevanceDelta = b.relevance - a.relevance;
  if (relevanceDelta !== 0) return relevanceDelta;

  const kindDelta = ON_DEMAND_KIND_RANK[a.kind] - ON_DEMAND_KIND_RANK[b.kind];
  if (kindDelta !== 0) return kindDelta;

  const keyDelta = compareStrings(a.key, b.key);
  if (keyDelta !== 0) return keyDelta;

  const sourceTypeDelta = compareStrings(a.source.type, b.source.type);
  if (sourceTypeDelta !== 0) return sourceTypeDelta;

  const sourceIdDelta = compareStrings(a.source.id, b.source.id);
  if (sourceIdDelta !== 0) return sourceIdDelta;

  const provenanceDelta = compareStrings(a.provenance.contentHash, b.provenance.contentHash);
  if (provenanceDelta !== 0) return provenanceDelta;

  return compareStrings(a.content, b.content);
};

if (ON_DEMAND_KIND_ORDER.length !== ON_DEMAND_DYNAMIC_KINDS.length) {
  throw new Error('On-demand kind order must cover every dynamic kind exactly once.');
}
