import { describe, expect, it } from 'vitest';

import type { ChatStreamPayload } from '../../types';
import { normalizeClaudeThinkingHistoryMessages } from './claudeThinkingHistory';

const CLAUDE_SIGNATURE = `EuYBCkQYAiJAHnHRJG4nPBrdTlo6CmXoyE8WYoQ+/=${'x'.repeat(900)}`;
const DEEPSEEK_SIGNATURE = '340acffe-0000-4000-8000-000000000000';

const toolCall = (id: string) => ({
  function: { arguments: '{"command":"ls"}', name: 'sandbox____runCommand' },
  id,
  type: 'function' as const,
});

const normalize = (messages: unknown[]) =>
  normalizeClaudeThinkingHistoryMessages(messages as ChatStreamPayload['messages']);

describe('normalizeClaudeThinkingHistoryMessages', () => {
  it('prepends Claude reasoning as a thinking block with the signature unchanged', () => {
    const [message] = normalize([
      {
        content: '',
        model: 'claude-opus-5-5',
        provider: 'anthropic',
        reasoning: { content: 'Run the suite first.', signature: CLAUDE_SIGNATURE },
        role: 'assistant',
        tool_calls: [toolCall('call-1')],
      },
    ]);

    expect(message.content).toEqual([
      { signature: CLAUDE_SIGNATURE, thinking: 'Run the suite first.', type: 'thinking' },
    ]);
    expect(message.tool_calls).toEqual([toolCall('call-1')]);
  });

  describe('cross-provider history is never sent as a Claude signature', () => {
    it.each([
      { label: 'a DeepSeek model', model: 'deepseek-v4-pro', provider: 'deepseek' },
      { label: 'DeepSeek routed through LobeHub', model: 'deepseek-v4-pro', provider: 'lobehub' },
      { label: 'a provider-only DeepSeek row', model: undefined, provider: 'deepseek' },
      {
        label: 'a Claude model without thinking with tools',
        model: 'claude-3-5-sonnet-20240620',
        provider: 'anthropic',
      },
    ])('skips reasoning from $label', ({ model, provider }) => {
      const source = {
        content: 'Listed the files.',
        ...(model && { model }),
        provider,
        reasoning: { content: 'Foreign reasoning', signature: DEEPSEEK_SIGNATURE },
        role: 'assistant',
        tool_calls: [toolCall('call-1')],
      };

      const [message] = normalize([source]);

      // Untouched: no thinking block, text and tool calls as they were.
      expect(message).toBe(source);
      expect(JSON.stringify(message.content)).not.toContain(DEEPSEEK_SIGNATURE);
    });

    it('strips signed thinking parts already in a foreign message, keeping text and tool parts', () => {
      const [message] = normalize([
        {
          content: [
            { signature: DEEPSEEK_SIGNATURE, thinking: 'DeepSeek reasoning', type: 'thinking' },
            { text: 'Listed the files.', type: 'text' },
          ],
          model: 'deepseek-v4-pro',
          provider: 'deepseek',
          role: 'assistant',
          tool_calls: [toolCall('call-1')],
        },
      ]);

      expect(message.content).toEqual([{ text: 'Listed the files.', type: 'text' }]);
      expect(message.tool_calls).toEqual([toolCall('call-1')]);
    });

    it('keeps Claude turns and drops DeepSeek turns in one mixed history', () => {
      const messages = normalize([
        { content: 'List the files.', role: 'user' },
        {
          content: '',
          model: 'claude-opus-5-5',
          provider: 'anthropic',
          reasoning: { content: 'Claude reasoning', signature: CLAUDE_SIGNATURE },
          role: 'assistant',
          tool_calls: [toolCall('call-claude')],
        },
        { content: 'src tests', role: 'tool', tool_call_id: 'call-claude' },
        {
          content: '',
          model: 'deepseek-v4-pro',
          provider: 'deepseek',
          reasoning: { content: 'DeepSeek reasoning', signature: DEEPSEEK_SIGNATURE },
          role: 'assistant',
          tool_calls: [toolCall('call-deepseek')],
        },
        { content: '42 total', role: 'tool', tool_call_id: 'call-deepseek' },
      ]);

      const thinkingBlocks = messages.flatMap((message) =>
        Array.isArray(message.content)
          ? message.content.filter((part) => part.type === 'thinking')
          : [],
      );

      expect(thinkingBlocks).toEqual([
        { signature: CLAUDE_SIGNATURE, thinking: 'Claude reasoning', type: 'thinking' },
      ]);
      expect(JSON.stringify(messages.map((message) => message.content))).not.toContain(
        DEEPSEEK_SIGNATURE,
      );
      expect(messages[3].content).toBe('');
    });
  });

  it('skips Claude reasoning that carries no signature', () => {
    const source = {
      content: 'Done.',
      model: 'claude-opus-5-5',
      provider: 'anthropic',
      reasoning: { content: 'Unsigned summary' },
      role: 'assistant',
    };

    expect(normalize([source])[0]).toBe(source);
  });
});
