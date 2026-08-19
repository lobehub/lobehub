import { TRACING_SCENARIOS } from '@lobechat/const';
import { TOPIC_TITLE_JSON_SCHEMA, TOPIC_TITLE_PROMPT_VERSION } from '@lobechat/prompts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SystemAgentService } from './index';

const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  getInfoForAIGeneration: vi.fn(),
  getUserSettings: vi.fn(),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: class {
    static getInfoForAIGeneration = mocks.getInfoForAIGeneration;
    getUserSettings = mocks.getUserSettings;
  },
}));
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(async () => ({ generateObject: mocks.generateObject })),
}));

describe('SystemAgentService.generateTopicTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserSettings.mockResolvedValue({ systemAgent: {} });
    mocks.getInfoForAIGeneration.mockResolvedValue({ responseLanguage: 'en-US' });
    mocks.generateObject.mockResolvedValue({ title: 'Account help' });
  });

  it('pairs the structured prompt with the schema it tells the model to match', async () => {
    const service = new SystemAgentService({} as never, 'user-1');

    const title = await service.generateTopicTitle({
      lastAssistantContent: 'Sure, I can help with that.',
      userPrompt: 'I need help with my account.',
    });

    expect(title).toBe('Account help');
    const [request, options] = mocks.generateObject.mock.calls[0];
    expect(request.schema).toBe(TOPIC_TITLE_JSON_SCHEMA);
    expect(request.messages[0].content).toContain(
      '- Return one JSON object with a single "title" string matching the supplied schema',
    );
    expect(options.tracing).toEqual({
      promptVersion: TOPIC_TITLE_PROMPT_VERSION,
      scenario: TRACING_SCENARIOS.TopicTitle,
      schemaName: TOPIC_TITLE_JSON_SCHEMA.name,
    });
  });

  it('returns null when the model yields no usable title', async () => {
    mocks.generateObject.mockResolvedValue({ title: '   ' });
    const service = new SystemAgentService({} as never, 'user-1');

    await expect(
      service.generateTopicTitle({ lastAssistantContent: 'Sure.', userPrompt: 'Help.' }),
    ).resolves.toBeNull();
  });
});
