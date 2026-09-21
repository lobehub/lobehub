// @vitest-environment node
import type { ModelRuntime } from '@lobechat/model-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';
import * as ModelRuntimeModule from '@/server/modules/ModelRuntime';

import { SystemAgentService } from './index';

vi.mock('@/database/models/user', () => ({
  UserModel: class {
    getUserSettings = async () => ({});

    static getInfoForAIGeneration = async () => ({ responseLanguage: 'en-US' });
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SystemAgentService.generateTopicTitle', () => {
  it('retains the requested topic identity across calls on a shared runtime', async () => {
    const generateObject = vi.fn().mockResolvedValue({ title: ' Generated title ' });
    vi.spyOn(ModelRuntimeModule, 'initModelRuntimeFromDB').mockResolvedValue({
      generateObject,
    } as unknown as ModelRuntime);
    const service = new SystemAgentService({} as LobeChatDatabase, 'user-1');

    for (const topicId of ['topic-a', 'topic-b', 'topic-a']) {
      expect(
        await service.generateTopicTitle({
          lastAssistantContent: 'Here is the answer.',
          topicId,
          userPrompt: 'A question',
        }),
      ).toBe('Generated title');
      expect(generateObject).toHaveBeenLastCalledWith(
        expect.objectContaining({ schema: expect.objectContaining({ name: 'topic_title' }) }),
        {
          metadata: { topicId, trigger: 'topic' },
          tracing: {
            promptVersion: expect.any(String),
            scenario: 'topic_title',
            schemaName: 'topic_title',
            topicId,
          },
        },
      );
    }
  });
});
