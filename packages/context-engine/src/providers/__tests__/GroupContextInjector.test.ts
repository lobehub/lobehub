import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { GroupContextInjector } from '../GroupContextInjector';

describe('GroupContextInjector', () => {
  const createContext = (messages: any[]): PipelineContext => ({
    initialState: { messages: [] },
    isAborted: false,
    messages,
    metadata: {},
  });

  describe('Basic Scenarios', () => {
    it('should inject group context before first user message', async () => {
      const injector = new GroupContextInjector({
        currentAgentId: 'agt_editor',
        currentAgentName: 'Editor',
        currentAgentRole: 'participant',
        enabled: true,
        groupTitle: 'Writing Team',
        members: [
          { id: 'agt_supervisor', name: 'Supervisor', role: 'supervisor' },
          { id: 'agt_writer', name: 'Writer', role: 'participant' },
          { id: 'agt_editor', name: 'Editor', role: 'participant' },
        ],
        systemPrompt: 'A team for collaborative writing',
      });

      const input: any[] = [
        { role: 'system', content: 'You are a helpful editor.' },
        { role: 'user', content: 'Please review this.' },
      ];

      const context = createContext(input);
      const result = await injector.process(context);

      // System message should be unchanged
      expect(result.messages[0].content).toBe('You are a helpful editor.');

      // Should have 3 messages now (system, injected, user)
      expect(result.messages).toHaveLength(3);

      // Check injected message (second message)
      const injectedContent = result.messages[1].content;
      expect(result.messages[1].role).toBe('user');

      // Agent identity (plain text, no wrapper)
      expect(injectedContent).toContain('You are "Editor"');
      expect(injectedContent).toContain('acting as a participant');
      expect(injectedContent).toContain('"Writing Team"');
      expect(injectedContent).toContain('agt_editor');
      expect(injectedContent).not.toContain('<agent_identity>');

      // Group context section with system prompt
      expect(injectedContent).toContain('<group_context>');
      expect(injectedContent).toContain('A team for collaborative writing');

      // Participants section with XML format
      expect(injectedContent).toContain('<group_participants>');
      expect(injectedContent).toContain('<member name="Supervisor" id="agt_supervisor" />');
      expect(injectedContent).toContain('<member name="Writer" id="agt_writer" />');
      expect(injectedContent).toContain('<member name="Editor" id="agt_editor" you="true" />');

      // Identity rules
      expect(injectedContent).toContain('<identity_rules>');
      expect(injectedContent).toContain('NEVER expose or display agent IDs');

      // Original user message should be third
      expect(result.messages[2].content).toBe('Please review this.');

      // Metadata should be updated
      expect(result.metadata.groupContextInjected).toBe(true);
    });

    it('should skip injection when disabled', async () => {
      const injector = new GroupContextInjector({
        currentAgentId: 'agt_editor',
        currentAgentName: 'Editor',
        enabled: false, // Disabled
      });

      const input: any[] = [
        { role: 'system', content: 'You are a helpful editor.' },
        { role: 'user', content: 'Hello' },
      ];

      const context = createContext(input);
      const result = await injector.process(context);

      // Should be unchanged - no injection
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].content).toBe('You are a helpful editor.');
      expect(result.messages[1].content).toBe('Hello');
      expect(result.metadata.groupContextInjected).toBeUndefined();
    });

    it('should skip injection when no user message exists', async () => {
      const injector = new GroupContextInjector({
        currentAgentId: 'agt_editor',
        currentAgentName: 'Editor',
        enabled: true,
      });

      const input: any[] = [{ role: 'system', content: 'You are a helpful editor.' }];

      const context = createContext(input);
      const result = await injector.process(context);

      // Messages should be unchanged - no user message to inject before
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('You are a helpful editor.');
      expect(result.metadata.groupContextInjected).toBe(true);
    });
  });

  describe('Variable Replacement', () => {
    it('should handle config with only identity info', async () => {
      const injector = new GroupContextInjector({
        currentAgentId: 'agt_editor',
        currentAgentName: 'Editor',
        currentAgentRole: 'participant',
        enabled: true,
      });

      const input: any[] = [
        { content: 'You are an editor.', role: 'system' },
        { content: 'Hello', role: 'user' },
      ];

      const context = createContext(input);
      const result = await injector.process(context);

      // Check injected message content
      expect(result.messages[1].content).toMatchSnapshot();
    });

    it('should handle config with only group info', async () => {
      const injector = new GroupContextInjector({
        enabled: true,
        groupTitle: 'Test Group',
        members: [{ id: 'agt_1', name: 'Agent 1', role: 'participant' }],
        systemPrompt: 'Test group description',
      });

      const input: any[] = [
        { content: 'System prompt.', role: 'system' },
        { content: 'Hello', role: 'user' },
      ];

      const context = createContext(input);
      const result = await injector.process(context);

      // Check injected message content
      expect(result.messages[1].content).toMatchSnapshot();
    });

    it('should handle empty config', async () => {
      const injector = new GroupContextInjector({
        enabled: true,
      });

      const input: any[] = [
        { content: 'Base prompt.', role: 'system' },
        { content: 'Hello', role: 'user' },
      ];

      const context = createContext(input);
      const result = await injector.process(context);

      // Check injected message content
      expect(result.messages[1].content).toMatchSnapshot();
    });
  });

  describe('Identity Rules Section', () => {
    it('should always include identity rules', async () => {
      const injector = new GroupContextInjector({
        enabled: true,
        // Minimal config
      });

      const input: any[] = [
        { role: 'system', content: 'Base prompt.' },
        { role: 'user', content: 'Hello' },
      ];

      const context = createContext(input);
      const result = await injector.process(context);

      // Check injected message content
      const injectedContent = result.messages[1].content;

      // Even with minimal config, identity rules should be present
      expect(injectedContent).toMatchSnapshot();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty members array', async () => {
      const injector = new GroupContextInjector({
        enabled: true,
        groupTitle: 'Empty Group',
        members: [],
        systemPrompt: 'Empty group description',
      });

      const input: any[] = [
        { content: 'Prompt.', role: 'system' },
        { content: 'Hello', role: 'user' },
      ];

      const context = createContext(input);
      const result = await injector.process(context);

      // Check injected message content
      expect(result.messages[1].content).toMatchSnapshot();
    });

    it('should preserve other messages unchanged', async () => {
      const injector = new GroupContextInjector({
        currentAgentId: 'agt_1',
        currentAgentName: 'Agent 1',
        enabled: true,
        groupTitle: 'Test Group',
      });

      const input: any[] = [
        { role: 'system', content: 'System prompt.' },
        { role: 'user', content: 'User message.' },
        { role: 'assistant', content: 'Assistant response.' },
      ];

      const context = createContext(input);
      const result = await injector.process(context);

      // System message should be unchanged
      expect(result.messages[0].content).toBe('System prompt.');

      // Injected message should be second
      expect(result.messages[1].role).toBe('user');
      expect(result.messages[1].content).toContain('<group_context>');

      // Original messages should be preserved
      expect(result.messages[2].content).toBe('User message.');
      expect(result.messages[3].content).toBe('Assistant response.');
    });
  });
});
