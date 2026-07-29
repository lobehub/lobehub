import { describe, expect, it } from 'vitest';

import { RECOMMENDED_SKILLS, RecommendedSkillType } from './recommendedSkill';
import {
  TASK_TEMPLATE_ICONS,
  TASK_TEMPLATE_RECOMMEND_COUNT,
  TASK_TEMPLATE_RECOMMEND_MAX_COUNT,
} from './taskTemplate';

describe('taskTemplate constants', () => {
  it('keeps the default recommendation count positive', () => {
    expect(TASK_TEMPLATE_RECOMMEND_COUNT).toBeGreaterThan(0);
  });

  it('keeps the maximum recommendation count above the default', () => {
    expect(TASK_TEMPLATE_RECOMMEND_MAX_COUNT).toBeGreaterThanOrEqual(TASK_TEMPLATE_RECOMMEND_COUNT);
  });

  it('keeps icon identifiers stable for renderers', () => {
    expect(TASK_TEMPLATE_ICONS).toEqual(['github']);
  });

  it('keeps PostHog visible in recommended LobeHub skills', () => {
    expect(RECOMMENDED_SKILLS).toContainEqual({
      id: 'posthog',
      type: RecommendedSkillType.Lobehub,
    });
  });
});
