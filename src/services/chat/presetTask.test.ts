import { chainTranslate } from '@lobechat/prompts';
import { RequestTrigger } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/store/agent';

import { chatService } from './index';

vi.mock('i18next', () => ({
  t: vi.fn((key: string) => `translated_${key}`),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChatService.fetchPresetTaskResult context', () => {
  it('sends only the preset task prompt, without the current agent context', async () => {
    // The user is chatting with an agent in agent mode with auto skill
    // activation — the state that makes a chat turn carry agent management,
    // identity and system-date context.
    useAgentStore.setState({
      activeAgentId: 'agt_current',
      agentMap: {
        agt_current: {
          chatConfig: { enableAgentMode: true, skillActivateMode: 'auto' },
          model: 'qwen3:1.7b',
          provider: 'ollama',
          systemRole: 'You are the current agent.',
          title: 'Current Agent',
        },
      },
    } as any);

    const getChatCompletionSpy = vi
      .spyOn(chatService, 'getChatCompletion')
      .mockResolvedValue(new Response(''));

    const task = chainTranslate('你好，世界', 'English');

    await chatService.fetchPresetTaskResult({
      params: { ...task, model: 'qwen3:1.7b', provider: 'ollama' },
      trigger: RequestTrigger.Translate,
    });

    const sent = getChatCompletionSpy.mock.calls[0][0].messages;
    expect(sent).toEqual(task.messages);
    expect(JSON.stringify(sent)).not.toContain('agent_management_context');
  });
});
