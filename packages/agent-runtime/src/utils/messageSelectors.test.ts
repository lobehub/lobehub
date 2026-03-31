import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { collectFromMessages, findInMessages } from './messageSelectors';

const createMessage = (overrides: Partial<UIChatMessage> = {}): UIChatMessage =>
  ({
    content: '',
    createdAt: Date.now(),
    id: 'msg-1',
    role: 'assistant',
    updatedAt: Date.now(),
    ...overrides,
  }) as UIChatMessage;

const createToolMessage = (overrides: Partial<UIChatMessage> = {}): UIChatMessage =>
  createMessage({ role: 'tool', ...overrides });

describe('findInMessages', () => {
  it('should return undefined for empty messages', () => {
    const result = findInMessages([], () => 'found');
    expect(result).toBeUndefined();
  });

  it('should return first match scanning from newest', () => {
    const messages = [
      createMessage({ content: 'old', id: '1' }),
      createMessage({ content: 'new', id: '2' }),
    ];

    const result = findInMessages(messages, (msg) => {
      if (msg.content) return msg.content;
    });

    expect(result).toBe('new');
  });

  it('should filter by role', () => {
    const messages = [
      createMessage({ content: 'assistant-msg', role: 'assistant' } as any),
      createToolMessage({ content: 'tool-msg' }),
    ];

    const result = findInMessages(messages, (msg) => msg.content || undefined, { role: 'tool' });

    expect(result).toBe('tool-msg');
  });

  it('should skip messages where visitor returns undefined', () => {
    const messages = [
      createToolMessage({ id: '1', pluginState: undefined }),
      createToolMessage({ id: '2', pluginState: { value: 42 } }),
    ];

    const result = findInMessages(messages, (msg) => msg.pluginState?.value as number | undefined, {
      role: 'tool',
    });

    expect(result).toBe(42);
  });
});

describe('collectFromMessages', () => {
  it('should return empty array for no matches', () => {
    const result = collectFromMessages([], () => 'found');
    expect(result).toEqual([]);
  });

  it('should collect all matches in forward order', () => {
    const messages = [
      createToolMessage({ id: '1', pluginState: { v: 'a' } }),
      createToolMessage({ id: '2', pluginState: { v: 'b' } }),
      createToolMessage({ id: '3', pluginState: undefined }),
    ];

    const result = collectFromMessages(
      messages,
      (msg) => msg.pluginState?.v as string | undefined,
      { role: 'tool' },
    );

    expect(result).toEqual(['a', 'b']);
  });

  it('should filter by role', () => {
    const messages = [
      createMessage({ content: 'user', role: 'user' } as any),
      createToolMessage({ content: 'tool' }),
    ];

    const result = collectFromMessages(messages, (msg) => msg.content || undefined, {
      role: 'tool',
    });

    expect(result).toEqual(['tool']);
  });
});
