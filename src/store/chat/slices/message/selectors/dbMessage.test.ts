import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { selectTodosFromMessages } from './dbMessage';

describe('selectTodosFromMessages', () => {
  const createGTDToolMessage = (todos: {
    items: Array<{ text: string; completed: boolean }>;
    updatedAt: string;
  }): UIChatMessage =>
    ({
      id: 'tool-msg-1',
      role: 'tool',
      content: 'Todos updated',
      plugin: {
        identifier: 'lobe-gtd',
        apiName: 'createTodos',
        arguments: '{}',
      },
      pluginState: {
        todos,
      },
    }) as unknown as UIChatMessage;

  it('should extract todos from the latest GTD tool message', () => {
    const messages: UIChatMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Create a todo list',
      } as UIChatMessage,
      createGTDToolMessage({
        items: [{ text: 'Buy milk', completed: false }],
        updatedAt: '2024-06-01T00:00:00.000Z',
      }),
    ];

    const result = selectTodosFromMessages(messages);

    expect(result).toBeDefined();
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0].text).toBe('Buy milk');
    expect(result?.items[0].completed).toBe(false);
  });

  it('should return the most recent todos when multiple GTD messages exist', () => {
    const messages: UIChatMessage[] = [
      createGTDToolMessage({
        items: [{ text: 'Old task', completed: false }],
        updatedAt: '2024-01-01T00:00:00.000Z',
      }),
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Task added',
      } as UIChatMessage,
      createGTDToolMessage({
        items: [
          { text: 'Old task', completed: true },
          { text: 'New task', completed: false },
        ],
        updatedAt: '2024-06-01T00:00:00.000Z',
      }),
    ];

    const result = selectTodosFromMessages(messages);

    expect(result).toBeDefined();
    expect(result?.items).toHaveLength(2);
    // Should be from the latest message
    expect(result?.items[0].text).toBe('Old task');
    expect(result?.items[0].completed).toBe(true);
    expect(result?.items[1].text).toBe('New task');
  });

  it('should return undefined when no GTD messages exist', () => {
    const messages: UIChatMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
      } as UIChatMessage,
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Hi there!',
      } as UIChatMessage,
    ];

    const result = selectTodosFromMessages(messages);

    expect(result).toBeUndefined();
  });

  it('should return undefined when messages array is empty', () => {
    const result = selectTodosFromMessages([]);

    expect(result).toBeUndefined();
  });

  it('should ignore non-GTD tool messages', () => {
    const messages: UIChatMessage[] = [
      {
        id: 'msg-1',
        role: 'tool',
        content: 'Search results',
        plugin: {
          identifier: 'lobe-web-browsing',
          apiName: 'search',
          arguments: '{}',
        },
        pluginState: {
          results: ['result 1'],
        },
      } as unknown as UIChatMessage,
    ];

    const result = selectTodosFromMessages(messages);

    expect(result).toBeUndefined();
  });

  it('should handle GTD message without pluginState.todos', () => {
    const messages: UIChatMessage[] = [
      {
        id: 'msg-1',
        role: 'tool',
        content: 'Something',
        plugin: {
          identifier: 'lobe-gtd',
          apiName: 'someOtherApi',
          arguments: '{}',
        },
        pluginState: {
          otherState: 'value',
        },
      } as unknown as UIChatMessage,
    ];

    const result = selectTodosFromMessages(messages);

    expect(result).toBeUndefined();
  });

  it('should provide default updatedAt when missing', () => {
    const messages: UIChatMessage[] = [
      {
        id: 'msg-1',
        role: 'tool',
        content: 'Todos',
        plugin: {
          identifier: 'lobe-gtd',
          apiName: 'createTodos',
          arguments: '{}',
        },
        pluginState: {
          todos: {
            items: [{ text: 'Task', completed: false }],
            // No updatedAt
          },
        },
      } as unknown as UIChatMessage,
    ];

    const result = selectTodosFromMessages(messages);

    expect(result).toBeDefined();
    expect(result?.updatedAt).toBeDefined();
    // Should be a valid ISO date string
    expect(new Date(result!.updatedAt).toISOString()).toBe(result!.updatedAt);
  });

  it('should handle legacy array format for todos', () => {
    const messages: UIChatMessage[] = [
      {
        id: 'msg-1',
        role: 'tool',
        content: 'Todos',
        plugin: {
          identifier: 'lobe-gtd',
          apiName: 'createTodos',
          arguments: '{}',
        },
        pluginState: {
          // Legacy format: direct array
          todos: [
            { text: 'Task 1', completed: false },
            { text: 'Task 2', completed: true },
          ],
        },
      } as unknown as UIChatMessage,
    ];

    const result = selectTodosFromMessages(messages);

    expect(result).toBeDefined();
    expect(result?.items).toHaveLength(2);
    expect(result?.items[0].text).toBe('Task 1');
    expect(result?.items[1].completed).toBe(true);
  });
});
