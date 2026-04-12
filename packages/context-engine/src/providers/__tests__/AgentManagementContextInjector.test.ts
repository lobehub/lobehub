import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { AgentBuilderContextInjector } from '../AgentBuilderContextInjector';
import { AgentManagementContextInjector } from '../AgentManagementContextInjector';
import { UserMemoryInjector } from '../UserMemoryInjector';

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
      expect(delegationMsg.content).toContain(
        'MUST call the `lobe-agent-management____callAgent____builtin` tool',
      );
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

  describe('multi-injector merge — fixes split systemInjection bug', () => {
    /**
     * Regression for the bug where AgentManagementContextInjector created its
     * own systemInjection message via splice(firstUserIndex, 0, ...) instead
     * of merging into the existing one. After UserMemory ran first, the
     * "first user" became the memory wrapper, so AgentManagement inserted
     * its message BEFORE the memory wrapper, splitting the consolidated
     * context into two messages with reversed order.
     *
     * Now that AgentManagement / AgentBuilder both extend
     * BaseFirstUserContentProvider, all three should merge into ONE message
     * in the order their injectors run.
     */
    it('should merge UserMemory + AgentBuilder + AgentManagement into ONE message', async () => {
      const memory = new UserMemoryInjector({
        enabled: true,
        memories: {
          contexts: [],
          experiences: [],
          preferences: [],
          persona: { tagline: 'tag', narrative: 'narr' },
        } as any,
      });
      const builder = new AgentBuilderContextInjector({
        enabled: true,
        agentContext: { meta: { title: 'Builder Agent' } },
      });
      const mgmt = new AgentManagementContextInjector({
        enabled: true,
        context: {
          availableProviders: [
            { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-4', name: 'GPT-4' }] },
          ],
        },
      });

      let ctx: PipelineContext = {
        initialState: { messages: [] },
        isAborted: false,
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'hi' },
        ],
        metadata: {},
      };

      // Run them in the same order MessagesEngine.buildProcessors uses
      ctx = await memory.process(ctx);
      ctx = await builder.process(ctx);
      ctx = await mgmt.process(ctx);

      // Expect exactly: [system, merged systemInjection, original user]
      expect(ctx.messages).toHaveLength(3);
      expect(ctx.messages[0].role).toBe('system');
      expect(ctx.messages[2].content).toBe('hi');

      const merged = ctx.messages[1];
      expect(merged.role).toBe('user');
      expect(merged.meta?.systemInjection).toBe(true);
      const content = merged.content as string;

      // All three context blocks present in the SAME message
      expect(content).toContain('<user_memory>');
      expect(content).toContain('<current_agent_context>');
      expect(content).toContain('Builder Agent');
      expect(content).toContain('<agent_management_context>');
      expect(content).toContain('gpt-4');

      // And in injector-run order: memory < builder < management
      expect(content.indexOf('<user_memory>')).toBeLessThan(
        content.indexOf('<current_agent_context>'),
      );
      expect(content.indexOf('<current_agent_context>')).toBeLessThan(
        content.indexOf('<agent_management_context>'),
      );
    });

    it('should still anchor mentionedAgents AFTER the real last user, not after merged systemInjection', async () => {
      const memory = new UserMemoryInjector({
        enabled: true,
        memories: {
          contexts: [],
          experiences: [],
          preferences: [],
          persona: { tagline: 'test tagline', narrative: 'test narrative' },
        } as any,
      });
      const mgmt = new AgentManagementContextInjector({
        enabled: true,
        context: {
          availableProviders: [{ id: 'openai', name: 'OpenAI', models: [] }],
          mentionedAgents: [{ id: 'agt_x', name: 'X' }],
        },
      });

      let ctx: PipelineContext = {
        initialState: { messages: [] },
        isAborted: false,
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'real user msg' },
        ],
        metadata: {},
      };

      ctx = await memory.process(ctx);
      ctx = await mgmt.process(ctx);

      // [system, merged context, real user, delegation]
      expect(ctx.messages).toHaveLength(4);
      expect(ctx.messages[1].content).toContain('<user_memory>');
      expect(ctx.messages[1].content).toContain('<agent_management_context>');
      expect(ctx.messages[2].content).toBe('real user msg');
      expect(ctx.messages[3].content).toContain('<mentioned_agents>');
      expect(ctx.messages[3].content).toContain('agt_x');
      // Delegation message must NOT be tagged systemInjection (otherwise
      // subsequent BFUCP injectors would try to append into it)
      expect(ctx.messages[3].meta?.systemInjection).toBeFalsy();
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
