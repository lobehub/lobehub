import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { GroupAgentBuilderContextInjector } from '../GroupAgentBuilderContextInjector';
import { UserMemoryInjector } from '../UserMemoryInjector';

describe('GroupAgentBuilderContextInjector', () => {
  const createContext = (messages: any[]): PipelineContext => ({
    initialState: { messages: [] },
    isAborted: false,
    messages,
    metadata: {},
  });

  describe('Basic Injection', () => {
    it('should inject group context before first user message', async () => {
      const injector = new GroupAgentBuilderContextInjector({
        enabled: true,
        groupContext: {
          groupId: 'grp_123',
          groupTitle: 'Test Group',
          members: [
            { id: 'agt_1', title: 'Agent 1', isSupervisor: true },
            { id: 'agt_2', title: 'Agent 2', isSupervisor: false },
          ],
        },
      });

      const context = createContext([
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Hello' },
      ]);

      const result = await injector.process(context);

      // Should have 3 messages now (system + injected user + original user)
      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[1].role).toBe('user');
      expect(result.messages[1].content).toContain('<current_group_context>');
      expect(result.messages[1].content).toContain('grp_123');
      expect(result.messages[1].content).toContain('Test Group');
      expect(result.messages[2].role).toBe('user');
      expect(result.messages[2].content).toBe('Hello');
    });

    it('should skip injection when not enabled', async () => {
      const injector = new GroupAgentBuilderContextInjector({
        enabled: false,
        groupContext: {
          groupId: 'grp_123',
        },
      });

      const context = createContext([
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Hello' },
      ]);

      const result = await injector.process(context);

      expect(result.messages).toHaveLength(2);
    });

    it('should skip injection when no group context provided', async () => {
      const injector = new GroupAgentBuilderContextInjector({
        enabled: true,
      });

      const context = createContext([
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Hello' },
      ]);

      const result = await injector.process(context);

      expect(result.messages).toHaveLength(2);
    });
  });

  describe('Content Consolidation with UserMemoryInjector', () => {
    it('should consolidate content into single user message when both injectors are used', async () => {
      // First injector: UserMemoryInjector
      const memoryInjector = new UserMemoryInjector({
        memories: {
          identities: [{ description: 'User is a developer', id: 'id_1' }],
        },
      });

      // Second injector: GroupAgentBuilderContextInjector
      const groupInjector = new GroupAgentBuilderContextInjector({
        enabled: true,
        groupContext: {
          groupId: 'grp_123',
          groupTitle: 'Dev Team',
        },
      });

      const context = createContext([
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ]);

      // Process through both injectors in order
      const afterMemory = await memoryInjector.process(context);
      const afterGroup = await groupInjector.process(afterMemory);

      // Should have 4 messages: system + SINGLE injected user + original user + assistant
      expect(afterGroup.messages).toHaveLength(4);

      // Check message order
      expect(afterGroup.messages[0].role).toBe('system');
      expect(afterGroup.messages[1].role).toBe('user'); // Consolidated injection
      expect(afterGroup.messages[2].role).toBe('user'); // Original user message
      expect(afterGroup.messages[3].role).toBe('assistant');

      // The consolidated message should contain BOTH user memory AND group context
      const injectedMessage = afterGroup.messages[1];
      expect(injectedMessage.content).toContain('<user_memory>'); // From UserMemoryInjector
      expect(injectedMessage.content).toContain('<current_group_context>'); // From GroupAgentBuilderContextInjector
      expect(injectedMessage.content).toContain('User is a developer');
      expect(injectedMessage.content).toContain('grp_123');
      expect(injectedMessage.content).toContain('Dev Team');
    });

    it('should work correctly when only GroupAgentBuilderContextInjector is used', async () => {
      const groupInjector = new GroupAgentBuilderContextInjector({
        enabled: true,
        groupContext: {
          groupId: 'grp_123',
          groupTitle: 'Test Group',
        },
      });

      const context = createContext([
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Hello' },
      ]);

      const result = await groupInjector.process(context);

      expect(result.messages).toHaveLength(3);
      expect(result.messages[1].content).toContain('<current_group_context>');
    });

    it('should work correctly when only UserMemoryInjector is used', async () => {
      const memoryInjector = new UserMemoryInjector({
        memories: {
          identities: [{ description: 'User is a developer', id: 'id_1' }],
        },
      });

      const context = createContext([
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Hello' },
      ]);

      const result = await memoryInjector.process(context);

      expect(result.messages).toHaveLength(3);
      expect(result.messages[1].content).toContain('<user_memory>');
    });

    it('should NOT create duplicate user messages when injectors run in sequence', async () => {
      const memoryInjector = new UserMemoryInjector({
        memories: {
          identities: [{ description: 'Identity 1', id: 'id_1' }],
          contexts: [{ title: 'Context 1', id: 'ctx_1' }],
        },
      });

      const groupInjector = new GroupAgentBuilderContextInjector({
        enabled: true,
        groupContext: {
          groupId: 'grp_123',
          groupTitle: 'Team Alpha',
          members: [
            { id: 'agt_1', title: 'Alice', isSupervisor: true },
            { id: 'agt_2', title: 'Bob', isSupervisor: false },
          ],
          config: {
            systemPrompt: 'Collaborate effectively',
          },
        },
      });

      const context = createContext([
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'First user message' },
        { role: 'assistant', content: 'First response' },
        { role: 'user', content: 'Second user message' },
      ]);

      // Process through both injectors
      const afterMemory = await memoryInjector.process(context);
      const afterGroup = await groupInjector.process(afterMemory);

      // Count user messages
      const userMessages = afterGroup.messages.filter((m) => m.role === 'user');

      // Should have 3 user messages: 1 consolidated injection + 2 original
      expect(userMessages).toHaveLength(3);

      // The first user message should be the consolidated injection
      expect(userMessages[0].content).toContain('<user_memory>');
      expect(userMessages[0].content).toContain('<current_group_context>');

      // Original messages should remain unchanged
      expect(userMessages[1].content).toBe('First user message');
      expect(userMessages[2].content).toBe('Second user message');
    });

    it('should preserve order: first injector content comes first in the consolidated message', async () => {
      // UserMemoryInjector runs first
      const memoryInjector = new UserMemoryInjector({
        memories: {
          identities: [{ description: 'Dev identity', id: 'id_1' }],
        },
      });

      // GroupAgentBuilderContextInjector runs second
      const groupInjector = new GroupAgentBuilderContextInjector({
        enabled: true,
        groupContext: {
          groupId: 'grp_order_test',
          groupTitle: 'Order Test Group',
        },
      });

      const context = createContext([{ role: 'user', content: 'Hello' }]);

      // Process in order: memory first, then group
      const afterMemory = await memoryInjector.process(context);
      const afterGroup = await groupInjector.process(afterMemory);

      const injectedContent = afterGroup.messages[0].content as string;

      // user_memory should appear BEFORE current_group_context
      const memoryIndex = injectedContent.indexOf('<user_memory>');
      const groupIndex = injectedContent.indexOf('<current_group_context>');

      expect(memoryIndex).toBeLessThan(groupIndex);
    });
  });

  describe('Group Context Formatting', () => {
    it('should format members correctly', async () => {
      const injector = new GroupAgentBuilderContextInjector({
        enabled: true,
        groupContext: {
          members: [
            {
              id: 'agt_1',
              title: 'Supervisor Agent',
              description: 'Manages the team',
              isSupervisor: true,
            },
            {
              id: 'agt_2',
              title: 'Worker Agent',
              description: 'Does the work',
              isSupervisor: false,
            },
          ],
        },
      });

      const context = createContext([{ role: 'user', content: 'Hello' }]);

      const result = await injector.process(context);

      const injectedContent = result.messages[0].content;
      expect(injectedContent).toContain('<group_members count="2">');
      expect(injectedContent).toContain('role="supervisor"');
      expect(injectedContent).toContain('role="participant"');
      expect(injectedContent).toContain('Supervisor Agent');
      expect(injectedContent).toContain('Worker Agent');
    });

    it('should format config correctly', async () => {
      const injector = new GroupAgentBuilderContextInjector({
        enabled: true,
        groupContext: {
          config: {
            scene: 'collaborative',
            enableSupervisor: true,
            systemPrompt: 'Work together as a team',
            openingMessage: 'Welcome to the team!',
            openingQuestions: ['How can I help?', 'What would you like to do?'],
          },
        },
      });

      const context = createContext([{ role: 'user', content: 'Hello' }]);

      const result = await injector.process(context);

      const injectedContent = result.messages[0].content;
      expect(injectedContent).toContain('<group_config>');
      expect(injectedContent).toContain('<scene>collaborative</scene>');
      expect(injectedContent).toContain('<enableSupervisor>true</enableSupervisor>');
      expect(injectedContent).toContain('<openingMessage>Welcome to the team!</openingMessage>');
      expect(injectedContent).toContain('<openingQuestions count="2">');
    });
  });
});
