import { describe, expect, it } from 'vitest';

import type { ExpertiseDomainDraft } from '@/services/expertise';

import { mergeAdjustedBlock } from './createDomainAdjustment';

const current: ExpertiseDomainDraft = {
  canonEntries: [{ key: 'old-canon', source: 'Old source', statement: 'Old', title: 'Old canon' }],
  domainFilter: 'Old filter',
  layerCanonRef: 'Old framework',
  layers: [{ description: 'Old', key: 'old-layer', title: 'Old layer' }],
  layerSource: 'canonical',
  outOfScope: 'Old exclusion',
  rationale: 'Old rationale',
  title: 'Old title',
};

const adjusted: ExpertiseDomainDraft = {
  canonEntries: [{ key: 'new-canon', source: 'New source', statement: 'New', title: 'New canon' }],
  domainFilter: 'New filter',
  layerCanonRef: 'New framework',
  layers: [{ description: 'New', key: 'new-layer', title: 'New layer' }],
  layerSource: 'invented',
  outOfScope: 'New exclusion',
  rationale: 'New rationale',
  title: 'New title',
};

describe('mergeAdjustedBlock', () => {
  it.each([
    ['domainFilter', 'New filter'],
    ['outOfScope', 'New exclusion'],
    ['rationale', 'New rationale'],
    ['canonEntries', adjusted.canonEntries],
    ['layers', adjusted.layers],
  ] as const)('only replaces the requested %s block', (target, expected) => {
    const result = mergeAdjustedBlock(current, adjusted, target);

    expect(result[target]).toEqual(expected);
    expect({ ...result, [target]: current[target] }).toEqual(current);
  });
});
