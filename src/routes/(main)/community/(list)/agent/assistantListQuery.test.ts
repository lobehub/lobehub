import { describe, expect, it } from 'vitest';

import { AssistantSorts } from '@/types/discover';

import { buildAssistantListQuery } from './assistantListQuery';

describe('buildAssistantListQuery', () => {
  it('should request the mixed list and category counts with one shared query', () => {
    expect(buildAssistantListQuery({ page: 2, q: 'pptx' })).toEqual({
      category: undefined,
      includeAgentGroup: true,
      includeCategoryCounts: true,
      order: undefined,
      page: 2,
      pageSize: 21,
      q: 'pptx',
      sort: AssistantSorts.Recommended,
      source: undefined,
    });
  });
});
