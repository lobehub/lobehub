// @vitest-environment node
import { ModelRuntime } from '@lobechat/model-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import * as ModelRuntimeModule from '@/server/modules/ModelRuntime';

import { SystemAgentService } from './index';

describe('SystemAgentService.generateTopicTitle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('preserves the source topic through outgoing OpenCode title requests', async () => {
    const sessions: (string | null)[] = [];
    const db = {
      query: {
        userSettings: {
          findFirst: vi.fn().mockResolvedValue({
            systemAgent: { topic: { model: 'glm-5', provider: 'opencodecodingplan' } },
          }),
        },
      },
    } as unknown as LobeChatDatabase;
    vi.spyOn(UserModel, 'getInfoForAIGeneration').mockResolvedValue({
      responseLanguage: 'en-US',
      userName: 'User',
    });
    vi.spyOn(ModelRuntimeModule, 'initModelRuntimeFromDB').mockImplementation(async () =>
      ModelRuntime.initializeWithProvider('opencodecodingplan', { apiKey: 'test' }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url) === 'https://models.dev/api.json') {
          return Response.json({ 'opencode-go': { models: {} } });
        }
        expect(String(url)).toBe('https://opencode.ai/zen/go/v1/chat/completions');
        sessions.push(new Headers(init?.headers).get('x-opencode-session'));
        return Response.json({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: '{"title":"Next steps"}', role: 'assistant' },
            },
          ],
        });
      }),
    );

    for (const topicId of ['topic-1', 'topic-1', 'topic-2']) {
      const service = new SystemAgentService(db, 'user-1');
      expect(
        await service.generateTopicTitle({
          lastAssistantContent: 'Here are the next steps.',
          topicId,
          userPrompt: 'What should I do next?',
        }),
      ).toBe('Next steps');
    }

    expect(sessions).toEqual(['topic-1', 'topic-1', 'topic-2']);
  });
});
