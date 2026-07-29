import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildAgentSkillSuggestionQueries,
  searchAgentSkillSuggestion,
} from './agentSkillSuggestion';

const marketApiMocks = vi.hoisted(() => ({
  searchSkill: vi.fn(),
}));

vi.mock('@/services/marketApi', () => ({
  marketApiService: {
    searchSkill: marketApiMocks.searchSkill,
  },
}));

describe('agent skill suggestion', () => {
  beforeEach(() => {
    marketApiMocks.searchSkill.mockReset();
  });

  it('builds market search queries only from fixed skill categories', () => {
    expect(buildAgentSkillSuggestionQueries('帮我创建一个简历优化助手')).toEqual(['resume review']);
  });

  it('does not use free-form agent prompts as market search queries', async () => {
    const prompt = '帮我创建一个 Acme 客户续约 SOP 检查清单，包含内部报价策略';

    expect(buildAgentSkillSuggestionQueries(prompt)).toEqual([]);

    const result = await searchAgentSkillSuggestion(prompt);

    expect(result).toBeUndefined();
    expect(marketApiMocks.searchSkill).not.toHaveBeenCalled();
  });
});
