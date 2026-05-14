import { TASK_TEMPLATE_RECOMMEND_COUNT, TASK_TEMPLATE_RECOMMEND_COUNT_MAX } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import { resolveRecommendationCount } from './resolveRecommendationCount';

describe('resolveRecommendationCount', () => {
  it('uses the shared default recommendation count', () => {
    expect(resolveRecommendationCount()).toBe(TASK_TEMPLATE_RECOMMEND_COUNT);
  });

  it('uses the requested recommendation count', () => {
    expect(resolveRecommendationCount(4)).toBe(4);
  });

  it('clamps the count to the supported range', () => {
    expect(resolveRecommendationCount(0)).toBe(1);
    expect(resolveRecommendationCount(TASK_TEMPLATE_RECOMMEND_COUNT_MAX + 1)).toBe(
      TASK_TEMPLATE_RECOMMEND_COUNT_MAX,
    );
  });
});
