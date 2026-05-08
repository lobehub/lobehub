import type { RecommendedTaskTemplate } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import {
  getTaskTemplateCardStateProperties,
  getTaskTemplateCommonAnalyticsProperties,
  getTaskTemplateImpressionStorageKey,
  getTaskTemplateListServedProperties,
} from './analytics';

const makeTemplate = (overrides: Partial<RecommendedTaskTemplate>): RecommendedTaskTemplate => ({
  category: 'engineering',
  cronPattern: '0 9 * * *',
  id: 'template-a',
  interests: ['coding'],
  source: 'matched',
  ...overrides,
});

describe('task template analytics helpers', () => {
  it('builds list served properties for matched and fallback recommendations', () => {
    const properties = getTaskTemplateListServedProperties({
      recommendationBatchId: 'batch-1',
      templates: [
        makeTemplate({ id: 'matched', source: 'matched' }),
        makeTemplate({
          fallbackPool: 'preferred_category',
          id: 'fallback',
          source: 'fallback',
        }),
      ],
      userInterestCount: 2,
    });

    expect(properties).toEqual({
      all_candidates_fallback_count: 0,
      fallback_count: 1,
      matched_count: 1,
      preferred_category_fallback_count: 1,
      recommendation_batch_id: 'batch-1',
      spm: 'home.task_templates.list_served',
      template_count: 2,
      user_interest_count: 2,
    });
  });

  it('builds common per-card properties without leaking interest values', () => {
    const properties = getTaskTemplateCommonAnalyticsProperties(
      {
        position: 1,
        recommendationBatchId: 'batch-1',
        template: makeTemplate({
          fallbackPool: 'all_candidates',
          optionalSkills: [{ provider: 'notion', source: 'klavis' }],
          requiresSkills: [{ provider: 'github', source: 'lobehub' }],
          source: 'fallback',
        }),
        userInterestCount: 3,
      },
      'home.task_templates.card_impression',
    );

    expect(properties).toMatchObject({
      fallback_pool: 'all_candidates',
      position: 1,
      recommendation_batch_id: 'batch-1',
      requires_skills: true,
      skill_sources: ['lobehub', 'klavis'],
      source: 'fallback',
      spm: 'home.task_templates.card_impression',
      template_category: 'engineering',
      template_id: 'template-a',
      user_interest_count: 3,
    });
  });

  it('resolves card state properties for connect-blocked cards', () => {
    expect(
      getTaskTemplateCardStateProperties({
        missingRequiredSkill: { provider: 'github', source: 'lobehub' },
        showOptionalHint: false,
        template: makeTemplate({
          requiresSkills: [{ provider: 'github', source: 'lobehub' }],
        }),
      }),
    ).toEqual({
      has_optional_connect_hint: false,
      has_optional_skills: false,
      has_required_skills: true,
      missing_required_skill_provider: 'github',
      missing_required_skill_source: 'lobehub',
      primary_action: 'connect_required',
    });
  });

  it('scopes impression de-duplication by user, UTC date, and template', () => {
    expect(
      getTaskTemplateImpressionStorageKey({
        date: new Date('2026-05-08T23:59:00Z'),
        templateId: 'template-a',
        userId: 'user-1',
      }),
    ).toBe('task-template-impression:user-1:2026-05-08:template-a');
  });
});
