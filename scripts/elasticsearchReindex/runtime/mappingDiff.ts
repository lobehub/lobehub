import { isDeepStrictEqual } from 'node:util';

import type {
  ElasticsearchFtsSearchMappingPropertyResponse,
  FtsSearchReindexGenerationDescription,
} from './elasticsearchClient';

export type FtsSearchMappingFieldChangeReason =
  'analyzer' | 'ignore_above' | 'multifields' | 'type';

export interface FtsSearchMappingFieldChange {
  field: string;
  reasons: FtsSearchMappingFieldChangeReason[];
}

export interface FtsSearchMappingDiff {
  /** Fields present in the declared mapping but absent from the live mapping. */
  added: string[];
  analysisChanged: boolean;
  changed: FtsSearchMappingFieldChange[];
  dynamicChanged: boolean;
  /** Fields present in the live mapping but absent from the declared mapping. */
  removed: string[];
}

type FtsSearchMappings = NonNullable<FtsSearchReindexGenerationDescription['mappings']>;

const FIELD_REASON_ORDER: readonly FtsSearchMappingFieldChangeReason[] = [
  'type',
  'analyzer',
  'ignore_above',
  'multifields',
];

const fieldChangeReasons = (
  live: ElasticsearchFtsSearchMappingPropertyResponse,
  declared: ElasticsearchFtsSearchMappingPropertyResponse,
): FtsSearchMappingFieldChangeReason[] =>
  FIELD_REASON_ORDER.filter((reason) => {
    switch (reason) {
      case 'type': {
        return live.type !== declared.type;
      }
      case 'analyzer': {
        return live.analyzer !== declared.analyzer;
      }
      case 'ignore_above': {
        return live.ignore_above !== declared.ignore_above;
      }
      case 'multifields': {
        return !isDeepStrictEqual(live.fields ?? {}, declared.fields ?? {});
      }
    }
  });

/** Produces a stable, field-level explanation of a live-to-declared mapping change. */
export const diffFtsSearchMappings = ({
  declared,
  declaredAnalysis,
  live,
  liveAnalysis,
}: {
  declared: FtsSearchMappings;
  declaredAnalysis: Record<string, unknown>;
  live: FtsSearchMappings;
  liveAnalysis: Record<string, unknown> | null;
}): FtsSearchMappingDiff => {
  const declaredFields = Object.keys(declared.properties).sort();
  const liveFields = Object.keys(live.properties).sort();
  const added = declaredFields.filter((field) => !(field in live.properties));
  const removed = liveFields.filter((field) => !(field in declared.properties));
  const changed = declaredFields.flatMap((field): FtsSearchMappingFieldChange[] => {
    const liveProperty = live.properties[field];
    if (!liveProperty) return [];
    const reasons = fieldChangeReasons(liveProperty, declared.properties[field]);
    return reasons.length > 0 ? [{ field, reasons }] : [];
  });

  return {
    added,
    analysisChanged: !isDeepStrictEqual(liveAnalysis, declaredAnalysis),
    changed,
    dynamicChanged: live.dynamic !== declared.dynamic,
    removed,
  };
};
