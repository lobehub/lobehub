import { describe, expect, it } from 'vitest';

import { BUILDER_SUGGESTION_SCHEMA_NAME, chainBuilderSuggestion } from './builderSuggestion';

describe('chainBuilderSuggestion', () => {
  it('builds a system + user message with the agent context for agent mode', () => {
    const { messages, schema } = chainBuilderSuggestion({
      contextSummary: 'Name: Helper\nSystem role: NOT set yet',
      mode: 'agent',
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Agent Builder');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('Name: Helper');
    expect(messages[1].content).toContain('agent');
    expect(schema.name).toBe(BUILDER_SUGGESTION_SCHEMA_NAME);
  });

  it('uses the group system prompt for group mode', () => {
    const { messages } = chainBuilderSuggestion({
      contextSummary: 'Members (0):',
      mode: 'group',
    });

    expect(messages[0].content).toContain('Group Agent Builder');
    expect(messages[1].content).toContain('group');
  });

  it('injects the locale instruction when a locale is provided', () => {
    const { messages } = chainBuilderSuggestion({
      contextSummary: 'x',
      locale: 'zh-CN',
      mode: 'agent',
    });

    expect(messages[1].content).toContain('zh-CN');
  });

  it('omits the locale instruction when no locale is provided', () => {
    const { messages } = chainBuilderSuggestion({ contextSummary: 'x', mode: 'agent' });
    expect(messages[1].content).not.toContain('language is');
  });
});
