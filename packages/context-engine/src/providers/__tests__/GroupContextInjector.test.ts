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
    it('should inject group context into system message', async () => {
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

      const systemContent = result.messages[0].content;

      // Original content should be preserved
      expect(systemContent).toContain('You are a helpful editor.');

      // Agent identity (plain text, no wrapper)
      expect(systemContent).toContain('You are "Editor"');
      expect(systemContent).toContain('acting as a participant');
      expect(systemContent).toContain('"Writing Team"');
      expect(systemContent).toContain('agt_editor');
      expect(systemContent).not.toContain('<agent_identity>');

      // Group context section with system prompt
      expect(systemContent).toContain('<group_context>');
      expect(systemContent).toContain('A team for collaborative writing');

      // Participants section with XML format
      expect(systemContent).toContain('<group_participants>');
      expect(systemContent).toContain('<member name="Supervisor" id="agt_supervisor" />');
      expect(systemContent).toContain('<member name="Writer" id="agt_writer" />');
      expect(systemContent).toContain('<member name="Editor" id="agt_editor" you="true" />');

      // Output rules section (important for LOBE-1866)
      expect(systemContent).toContain('<critical_output_rules>');
      expect(systemContent).toContain('<group_context>');
      expect(systemContent).toContain('NEVER start your response with');

      // Identity rules
      expect(systemContent).toContain('<identity_rules>');
      expect(systemContent).toContain('NEVER expose or display agent IDs');

      // Metadata should be updated
      expect(result.metadata.groupContextInjected).toBe(true);
    });

    it('should skip injection when disabled', async () => {
      const injector = new GroupContextInjector({
        currentAgentId: 'agt_editor',
        currentAgentName: 'Editor',
        enabled: false, // Disabled
      });

      const input: any[] = [{ role: 'system', content: 'You are a helpful editor.' }];

      const context = createContext(input);
      const result = await injector.process(context);

      // Should be unchanged
      expect(result.messages[0].content).toBe('You are a helpful editor.');
      expect(result.metadata.groupContextInjected).toBeUndefined();
    });

    it('should skip injection when no system message exists', async () => {
      const injector = new GroupContextInjector({
        currentAgentId: 'agt_editor',
        currentAgentName: 'Editor',
        enabled: true,
      });

      const input: any[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const context = createContext(input);
      const result = await injector.process(context);

      // Messages should be unchanged
      expect(result.messages[0].content).toBe('Hello');
      expect(result.messages[1].content).toBe('Hi there!');
      expect(result.metadata.groupContextInjected).toBeUndefined();
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

      const input: any[] = [{ content: 'You are an editor.', role: 'system' }];

      const context = createContext(input);
      const result = await injector.process(context);

      expect(result.messages[0].content).toMatchSnapshot();
    });

    it('should handle config with only group info', async () => {
      const injector = new GroupContextInjector({
        enabled: true,
        groupTitle: 'Test Group',
        members: [{ id: 'agt_1', name: 'Agent 1', role: 'participant' }],
        systemPrompt: 'Test group description',
      });

      const input: any[] = [{ content: 'System prompt.', role: 'system' }];

      const context = createContext(input);
      const result = await injector.process(context);

      expect(result.messages[0].content).toMatchSnapshot();
    });

    it('should handle empty config', async () => {
      const injector = new GroupContextInjector({
        enabled: true,
      });

      const input: any[] = [{ content: 'Base prompt.', role: 'system' }];

      const context = createContext(input);
      const result = await injector.process(context);

      expect(result.messages[0].content).toMatchSnapshot();
    });
  });

  describe('Output Rules Section (LOBE-1866)', () => {
    it('should always include critical output rules', async () => {
      const injector = new GroupContextInjector({
        enabled: true,
        // Minimal config
      });

      const input: any[] = [{ role: 'system', content: 'Base prompt.' }];

      const context = createContext(input);
      const result = await injector.process(context);

      const systemContent = result.messages[0].content;

      // Even with minimal config, critical output rules should be present
      expect(systemContent).toContain('<critical_output_rules>');
      expect(systemContent).toContain('Your responses must contain ONLY your actual reply content');
      expect(systemContent).toContain('NEVER start your response with');
      expect(systemContent).toContain('<speaker');

      // Identity rules should also be present
      expect(systemContent).toContain('<identity_rules>');
      expect(systemContent).toContain('NEVER expose or display agent IDs');
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

      const input: any[] = [{ content: 'Prompt.', role: 'system' }];

      const context = createContext(input);
      const result = await injector.process(context);

      expect(result.messages[0].content).toMatchSnapshot();
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

      // Only system message should be modified
      expect(result.messages[0].content).toContain('<group_context>');
      expect(result.messages[1].content).toBe('User message.');
      expect(result.messages[2].content).toBe('Assistant response.');
    });
  });
});
