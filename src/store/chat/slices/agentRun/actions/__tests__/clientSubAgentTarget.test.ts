import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';
import { aiAgentService } from '@/services/aiAgent';
import { getAgentStoreState } from '@/store/agent';

import { useChatStore } from '../../../../store';
import { resolveClientSubAgentTarget } from '../transports/client/clientSubAgentTarget';
import { resetTestEnvironment } from './helpers';

const TARGET = { model: 'gpt-5.4', provider: 'openai', title: 'Designer' };

/**
 * `callSubAgent({ agentId })` in the client runtime (gateway mode off): the
 * child runs as the named agent on its own config, inline like any client
 * sub-agent.
 */
describe('client sub-agent with a target agent', () => {
  beforeEach(() => {
    resetTestEnvironment();
    vi.restoreAllMocks();
  });

  describe('resolveClientSubAgentTarget', () => {
    it('loads a target the store has not seen yet', async () => {
      vi.spyOn(agentService, 'getAgentConfigById').mockResolvedValue(TARGET as any);

      const target = await resolveClientSubAgentTarget('agent-designer');

      expect(target).toMatchObject({ config: TARGET, title: 'Designer' });
      expect(getAgentStoreState().agentMap['agent-designer']).toMatchObject(TARGET);
    });

    it('reports an agent the user cannot access', async () => {
      vi.spyOn(agentService, 'getAgentConfigById').mockResolvedValue(null as any);

      const target = await resolveClientSubAgentTarget('agent-foreign');

      expect(target).toMatchObject({ error: expect.stringContaining('do not have access') });
    });

    // Its CLI is started by the server's dispatch, which this runtime bypasses.
    it('refuses an external agent such as Claude Code, saying why', async () => {
      vi.spyOn(agentService, 'getAgentConfigById').mockResolvedValue({
        agencyConfig: { heterogeneousProvider: { type: 'claude-code' } },
        title: 'Claude Code',
      } as any);

      const target = await resolveClientSubAgentTarget('agent-cc');

      expect(target).toMatchObject({ error: expect.stringContaining('external agent') });
    });
  });

  describe('runClientSubAgent', () => {
    it('runs the target in its own thread, on its own model', async () => {
      vi.spyOn(agentService, 'getAgentConfigById').mockResolvedValue(TARGET as any);
      const createThread = vi.spyOn(aiAgentService, 'createClientTaskThread').mockResolvedValue({
        success: true,
        threadId: 'thd_target',
        threadMessages: [],
        userMessageId: 'user-msg-1',
      } as any);
      vi.spyOn(aiAgentService, 'updateClientTaskThreadStatus').mockResolvedValue({} as any);
      const execute = vi
        .spyOn(useChatStore.getState(), 'executeClientAgent')
        .mockResolvedValue({ model: 'gpt-5.4' } as any);
      useChatStore.setState({ executeClientAgent: execute } as any);

      const result = await useChatStore.getState().runClientSubAgent({
        agentId: 'agent-parent',
        description: 'Logo',
        instruction: 'Draft a logo',
        targetAgentId: 'agent-designer',
        toolMessageId: 'tool-msg-1',
        topicId: 'topic-1',
      });

      expect(result).toMatchObject({ success: true, threadId: 'thd_target' });
      expect(createThread).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-designer', topicId: 'topic-1' }),
      );
      const [runParams] = execute.mock.calls[0];
      expect(runParams.context).toMatchObject({ agentId: 'agent-designer', isSubAgent: true });
      // A named agent keeps the model configured on it.
      expect(runParams.modelOverride).toBeUndefined();
      expect(runParams.chatConfigOverride).toBeUndefined();
    });

    it('starts nothing when the target cannot be reached', async () => {
      vi.spyOn(agentService, 'getAgentConfigById').mockResolvedValue(null as any);
      const createThread = vi.spyOn(aiAgentService, 'createClientTaskThread');

      const result = await useChatStore.getState().runClientSubAgent({
        agentId: 'agent-parent',
        description: 'Logo',
        instruction: 'Draft a logo',
        targetAgentId: 'agent-foreign',
        toolMessageId: 'tool-msg-1',
        topicId: 'topic-1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('do not have access');
      expect(createThread).not.toHaveBeenCalled();
    });
  });
});
