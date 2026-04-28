import { type UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { selectCurrentTurnTodosFromMessages, selectTodosFromMessages } from './dbMessage';

describe('selectTodosFromMessages', () => {
  const createGTDToolMessage = (todos: {
    items: Array<{ text: string; status: 'todo' | 'processing' | 'completed' }>;
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
        items: [{ text: 'Buy milk', status: 'todo' }],
        updatedAt: '2024-06-01T00:00:00.000Z',
      }),
    ];

    const result = selectTodosFromMessages(messages);

    expect(result).toBeDefined();
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0].text).toBe('Buy milk');
    expect(result?.items[0].status).toBe('todo');
  });

  it('should return the most recent todos when multiple GTD messages exist', () => {
    const messages: UIChatMessage[] = [
      createGTDToolMessage({
        items: [{ text: 'Old task', status: 'todo' }],
        updatedAt: '2024-01-01T00:00:00.000Z',
      }),
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Task added',
      } as UIChatMessage,
      createGTDToolMessage({
        items: [
          { text: 'Old task', status: 'completed' },
          { text: 'New task', status: 'todo' },
        ],
        updatedAt: '2024-06-01T00:00:00.000Z',
      }),
    ];

    const result = selectTodosFromMessages(messages);

    expect(result).toBeDefined();
    expect(result?.items).toHaveLength(2);
    // Should be from the latest message
    expect(result?.items[0].text).toBe('Old task');
    expect(result?.items[0].status).toBe('completed');
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
            items: [{ text: 'Task', status: 'todo' }],
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

  it('should pick up pluginState.todos from a non-GTD tool message (CC TodoWrite)', () => {
    // Heterogeneous-agent tools (Claude Code TodoWrite, future ACP/Codex
    // equivalents) synthesize `pluginState.todos` with identifier
    // 'claude-code'. The selector is a shared contract on `pluginState.todos`
    // — it must not filter by plugin.identifier.
    const messages: UIChatMessage[] = [
      {
        id: 'msg-1',
        role: 'tool',
        content: 'Todos have been modified successfully',
        plugin: {
          identifier: 'claude-code',
          apiName: 'TodoWrite',
          arguments: '{}',
        },
        pluginState: {
          todos: {
            items: [
              { text: 'Investigating the bug', status: 'processing' },
              { text: 'Write a test', status: 'todo' },
            ],
            updatedAt: '2026-04-19T00:00:00.000Z',
          },
        },
      } as unknown as UIChatMessage,
    ];

    const result = selectTodosFromMessages(messages);

    expect(result).toBeDefined();
    expect(result?.items).toHaveLength(2);
    expect(result?.items[0].status).toBe('processing');
    expect(result?.updatedAt).toBe('2026-04-19T00:00:00.000Z');
  });

  it('should prefer the most recent pluginState.todos across producers', () => {
    // GTD wrote first, then CC TodoWrite wrote later — the latest producer
    // wins regardless of identifier.
    const messages: UIChatMessage[] = [
      createGTDToolMessage({
        items: [{ text: 'old gtd task', status: 'todo' }],
        updatedAt: '2026-04-01T00:00:00.000Z',
      }),
      {
        id: 'msg-2',
        role: 'tool',
        content: 'Todos have been modified successfully',
        plugin: {
          identifier: 'claude-code',
          apiName: 'TodoWrite',
          arguments: '{}',
        },
        pluginState: {
          todos: {
            items: [{ text: 'cc task', status: 'processing' }],
            updatedAt: '2026-04-19T00:00:00.000Z',
          },
        },
      } as unknown as UIChatMessage,
    ];

    const result = selectTodosFromMessages(messages);
    expect(result?.items[0].text).toBe('cc task');
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
            { text: 'Task 1', status: 'todo' },
            { text: 'Task 2', status: 'completed' },
          ],
        },
      } as unknown as UIChatMessage,
    ];

    const result = selectTodosFromMessages(messages);

    expect(result).toBeDefined();
    expect(result?.items).toHaveLength(2);
    expect(result?.items[0].text).toBe('Task 1');
    expect(result?.items[1].status).toBe('completed');
  });
});

describe('selectCurrentTurnTodosFromMessages', () => {
  const gtdMessage = (text: string, status: 'todo' | 'processing' | 'completed'): UIChatMessage =>
    ({
      id: `tool-${text}`,
      role: 'tool',
      content: 'Todos updated',
      plugin: { identifier: 'lobe-gtd', apiName: 'createTodos', arguments: '{}' },
      pluginState: {
        todos: { items: [{ text, status }], updatedAt: '2026-04-20T00:00:00.000Z' },
      },
    }) as unknown as UIChatMessage;

  const userMessage = (id: string, content = 'hi'): UIChatMessage =>
    ({ id, role: 'user', content }) as UIChatMessage;

  it('returns todos from the current turn only', () => {
    const messages: UIChatMessage[] = [
      userMessage('u1'),
      gtdMessage('turn 1 task', 'completed'),
      userMessage('u2'),
      gtdMessage('turn 2 task', 'processing'),
    ];

    const result = selectCurrentTurnTodosFromMessages(messages);

    expect(result?.items).toHaveLength(1);
    expect(result?.items[0].text).toBe('turn 2 task');
  });

  it('returns undefined once a new user turn starts without its own todos', () => {
    const messages: UIChatMessage[] = [
      userMessage('u1'),
      gtdMessage('previous turn task', 'completed'),
      userMessage('u2'),
    ];

    const result = selectCurrentTurnTodosFromMessages(messages);

    expect(result).toBeUndefined();
  });

  it('falls back to full history when no user message exists', () => {
    const messages: UIChatMessage[] = [gtdMessage('greeting task', 'todo')];

    const result = selectCurrentTurnTodosFromMessages(messages);

    expect(result?.items[0].text).toBe('greeting task');
  });
});
