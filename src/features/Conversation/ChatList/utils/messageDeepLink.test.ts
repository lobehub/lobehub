import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { resolveMessageDeepLink } from './messageDeepLink';

const message = (id: string, overrides: Partial<UIChatMessage> = {}): UIChatMessage => ({
  content: '',
  createdAt: 0,
  id,
  role: 'user',
  updatedAt: 0,
  ...overrides,
});

const deepLink = (id: string) => ({ id, navigationKey: 'navigation-1' });

const resolve = (messages: UIChatMessage[], id: string, rowIds = messages.map((m) => m.id)) =>
  resolveMessageDeepLink(messages, rowIds, deepLink(id));

describe('resolveMessageDeepLink', () => {
  it('returns the top-level virtual row for a direct message', () => {
    const messages = [message('first'), message('target')];

    expect(resolve(messages, 'target')).toMatchObject({
      displayMessageId: 'target',
      index: 1,
    });
  });

  it('returns the owning assistant group for a nested assistant message', () => {
    const messages = [
      message('user'),
      message('assistant-group', {
        children: [
          { content: 'first', id: 'assistant-1' },
          { content: 'search hit', id: 'assistant-2' },
        ],
        role: 'assistantGroup',
      }),
    ];

    expect(resolve(messages, 'assistant-2')).toMatchObject({
      displayMessageId: 'assistant-group',
      index: 1,
    });
  });

  it('resolves nested task, council, and compressed messages to their virtual row', () => {
    const messages = [
      message('tasks-row', { tasks: [message('task-hit', { role: 'task' })], role: 'tasks' }),
      message('council-row', {
        members: [message('council-hit', { role: 'assistant' })],
        role: 'agentCouncil',
      }),
      message('compressed-row', {
        compressedMessages: [message('compressed-hit')],
        role: 'compressedGroup',
      }),
    ];

    expect(resolve(messages, 'task-hit')?.index).toBe(0);
    expect(resolve(messages, 'council-hit')?.index).toBe(1);
    expect(resolve(messages, 'compressed-hit')?.index).toBe(2);
  });

  it('returns undefined when the message is not rendered by the list', () => {
    expect(resolve([message('first')], 'missing')).toBeUndefined();
  });

  it('targets the host row for a message folded into a steered chain', () => {
    const messages = [
      message('user'),
      message('group-1', { children: [{ content: '', id: 'group-1' }], role: 'assistantGroup' }),
      message('steer-1', { metadata: { steer: true } }),
      message('group-2', { children: [{ content: '', id: 'child-2' }], role: 'assistantGroup' }),
    ];
    const rowIds = ['user', 'group-1'];

    expect(resolve(messages, 'child-2', rowIds)).toMatchObject({
      displayMessageId: 'group-1',
      index: 1,
    });
    expect(resolve(messages, 'steer-1', rowIds)).toMatchObject({
      displayMessageId: 'group-1',
      index: 1,
    });
  });
});
