import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { AgentManagementContextInjector } from '../AgentManagementContextInjector';

describe('AgentManagementContextInjector', () => {
  const createContext = (messages: any[]): PipelineContext => ({
    initialState: { messages: [] },
    isAborted: false,
    messages,
    metadata: {},
  });

  describe('disabled / no context', () => {
    it('should skip when disabled', async () => {
      const injector = new AgentManagementContextInjector({ enabled: false });
      const ctx = createContext([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ]);
      const result = await injector.process(ctx);
      expect(result.messages).toHaveLength(2);
    });

    it('should skip when no context provided', async () => {
      const injector = new AgentManagementContextInjector({ enabled: true });
      const ctx = createContext([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ]);
      const result = await injector.process(ctx);
      expect(result.messages).toHaveLength(2);
    });
  });

  describe('agent-management context (providers/plugins)', () => {
    it('should inject before the first user message', async () => {
      const injector = new AgentManagementContextInjector({
        enabled: true,
        context: {
          availableProviders: [
            {
              id: 'openai',
              name: 'OpenAI',
              models: [{ id: 'gpt-4', name: 'GPT-4' }],
            },
          ],
        },
      });

      const ctx = createContext([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'create an agent' },
      ]);
      const result = await injector.process(ctx);

      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].role).toBe('system');
      // Injected context before user message
      expect(result.messages[1].role).toBe('user');
      expect(result.messages[1].content).toContain('<agent_management_context>');
      expect(result.messages[1].content).toContain('gpt-4');
      // Original user message
      expect(result.messages[2].content).toBe('create an agent');
      expect(result.metadata.agentManagementContextInjected).toBe(true);
    });
  });

  describe('mentionedAgents delegation', () => {
    it('should inject delegation context after the last user message', async () => {
      const injector = new AgentManagementContextInjector({
        enabled: true,
        context: {
          mentionedAgents: [{ id: 'agt_designer', name: 'Designer Agent' }],
        },
      });

      const ctx = createContext([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'Let @Designer Agent help me' },
      ]);
      const result = await injector.process(ctx);

      // system + user + injected delegation
      expect(result.messages).toHaveLength(3);
      expect(result.messages[1].content).toBe('Let @Designer Agent help me');

      const delegationMsg = result.messages[2];
      expect(delegationMsg.role).toBe('user');
      expect(delegationMsg.content).toContain('<mentioned_agents>');
      expect(delegationMsg.content).toContain('agt_designer');
      expect(delegationMsg.content).toContain('Designer Agent');
      expect(delegationMsg.content).toContain('MUST use the callAgent tool');
      expect(delegationMsg.meta.injectType).toBe('agent-mention-delegation');
    });

    it('should inject after the LAST user message, not the first', async () => {
      const injector = new AgentManagementContextInjector({
        enabled: true,
        context: {
          mentionedAgents: [{ id: 'agt_1', name: 'Agent A' }],
        },
      });

      const ctx = createContext([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'first message' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'Let @Agent A do this' },
      ]);
      const result = await injector.process(ctx);

      // system + user + assistant + user + injected
      expect(result.messages).toHaveLength(5);
      expect(result.messages[3].content).toBe('Let @Agent A do this');
      expect(result.messages[4].content).toContain('<mentioned_agents>');
      expect(result.messages[4].content).toContain('agt_1');
    });

    it('should handle multiple mentioned agents', async () => {
      const injector = new AgentManagementContextInjector({
        enabled: true,
        context: {
          mentionedAgents: [
            { id: 'agt_1', name: 'Agent A' },
            { id: 'agt_2', name: 'Agent B' },
          ],
        },
      });

      const ctx = createContext([{ role: 'user', content: 'hello' }]);
      const result = await injector.process(ctx);

      const delegationMsg = result.messages[1];
      expect(delegationMsg.content).toContain('agt_1');
      expect(delegationMsg.content).toContain('agt_2');
      expect(delegationMsg.content).toContain('Agent A');
      expect(delegationMsg.content).toContain('Agent B');
    });
  });

  describe('combined: agent-management + mentionedAgents', () => {
    it('should inject providers before first user and delegation after last user', async () => {
      const injector = new AgentManagementContextInjector({
        enabled: true,
        context: {
          availableProviders: [
            {
              id: 'anthropic',
              name: 'Anthropic',
              models: [{ id: 'claude-sonnet-4-5-20250514', name: 'Claude Sonnet' }],
            },
          ],
          mentionedAgents: [{ id: 'agt_dev', name: 'Developer' }],
        },
      });

      const ctx = createContext([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'Let @Developer build this' },
      ]);
      const result = await injector.process(ctx);

      // system + management_context + user + delegation
      expect(result.messages).toHaveLength(4);

      // Management context before first user
      expect(result.messages[1].content).toContain('<agent_management_context>');
      expect(result.messages[1].content).toContain('claude-sonnet-4-5-20250514');
      // Management context should NOT contain mentionedAgents
      expect(result.messages[1].content).not.toContain('<mentioned_agents>');

      // Original user message
      expect(result.messages[2].content).toBe('Let @Developer build this');

      // Delegation after last user
      expect(result.messages[3].content).toContain('<mentioned_agents>');
      expect(result.messages[3].content).toContain('agt_dev');
    });
  });

  describe('only mentionedAgents (no providers/plugins)', () => {
    it('should NOT inject empty agent-management context but SHOULD inject delegation', async () => {
      const injector = new AgentManagementContextInjector({
        enabled: true,
        context: {
          // No providers, no plugins — only mentionedAgents
          mentionedAgents: [{ id: 'agt_x', name: 'Agent X' }],
        },
      });

      const ctx = createContext([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'Ask @Agent X' },
      ]);
      const result = await injector.process(ctx);

      // system + user + delegation (no empty management context)
      expect(result.messages).toHaveLength(3);
      expect(result.messages[1].content).toBe('Ask @Agent X');
      expect(result.messages[2].content).toContain('<mentioned_agents>');
      expect(result.messages[2].content).toContain('agt_x');
    });
  });
});
