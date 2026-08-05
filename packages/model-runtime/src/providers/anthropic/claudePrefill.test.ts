import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';

import { stripUnsupportedClaudeAssistantPrefill } from './claudePrefill';

const user = (text: string): Anthropic.MessageParam => ({ content: text, role: 'user' });
const assistant = (text: string): Anthropic.MessageParam => ({ content: text, role: 'assistant' });

describe('stripUnsupportedClaudeAssistantPrefill', () => {
  it('should strip a single trailing assistant message on Claude 5', () => {
    const messages = [user('hi'), assistant('draft')];

    expect(stripUnsupportedClaudeAssistantPrefill('claude-opus-5', messages)).toEqual([user('hi')]);
  });

  it('should strip ALL stacked trailing assistant messages', () => {
    // Regression LOBE-12572: failed-run placeholders can stack multiple
    // assistant turns at the tail; popping only one still returns 400.
    const messages = [
      user('hi'),
      assistant('a'),
      user('retry'),
      assistant('...'),
      assistant('...'),
    ];

    expect(stripUnsupportedClaudeAssistantPrefill('claude-opus-5', messages)).toEqual([
      user('hi'),
      assistant('a'),
      user('retry'),
    ]);
  });

  it('should keep mid-conversation assistant messages untouched', () => {
    const messages = [user('hi'), assistant('a'), user('ok')];

    expect(stripUnsupportedClaudeAssistantPrefill('claude-opus-5', messages)).toBe(messages);
  });

  it('should leave prefill-capable models untouched', () => {
    const messages = [user('hi'), assistant('draft')];

    expect(stripUnsupportedClaudeAssistantPrefill('claude-opus-4-5', messages)).toBe(messages);
    expect(stripUnsupportedClaudeAssistantPrefill('claude-3-5-haiku-20241022', messages)).toBe(
      messages,
    );
  });

  it('should return an empty list when every message is assistant', () => {
    expect(
      stripUnsupportedClaudeAssistantPrefill('claude-opus-5', [assistant('a'), assistant('b')]),
    ).toEqual([]);
  });
});
