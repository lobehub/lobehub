import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { enqueueSelfIterationRun } from './enqueueSelfIterationRun';

const execAgent = vi.fn();
const getUserSettings = vi.fn();

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: class {
    execAgent = execAgent;
  },
}));

vi.mock('@/database/models/user', () => ({
  UserModel: class {
    getUserSettings = getUserSettings;
  },
}));

describe('enqueueSelfIterationRun', () => {
  beforeEach(() => {
    execAgent.mockReset().mockResolvedValue({ operationId: 'op-1', topicId: 'topic-1' });
    getUserSettings.mockReset();
  });

  it('runs the builtin agent on the user Memory Analysis model', async () => {
    getUserSettings.mockResolvedValue({
      systemAgent: { memoryAnalysisAgentConfig: { model: 'gpt-6.1-sol', provider: 'chatgpt' } },
    });

    await enqueueSelfIterationRun({
      agentId: 'agent-1',
      db: {} as LobeChatDatabase,
      marker: { agentId: 'agent-1', kind: 'self-reflection', sourceId: 'source-1' },
      prompt: 'review',
      slug: BUILTIN_AGENT_SLUGS.selfReflection,
      userId: 'user-1',
    });

    expect(execAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-6.1-sol',
        provider: 'chatgpt',
        slug: BUILTIN_AGENT_SLUGS.selfReflection,
      }),
    );
  });
});
