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

describe('resolveMessageDeepLink', () => {
  it('returns the top-level virtual row for a direct message', () => {
    const messages = [message('first'), message('target')];

    expect(resolveMessageDeepLink(messages, deepLink('target'))).toMatchObject({
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

    expect(resolveMessageDeepLink(messages, deepLink('assistant-2'))).toMatchObject({
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

    expect(resolveMessageDeepLink(messages, deepLink('task-hit'))?.index).toBe(0);
    expect(resolveMessageDeepLink(messages, deepLink('council-hit'))?.index).toBe(1);
    expect(resolveMessageDeepLink(messages, deepLink('compressed-hit'))?.index).toBe(2);
  });

  it('returns undefined when the message is not rendered by the list', () => {
    expect(resolveMessageDeepLink([message('first')], deepLink('missing'))).toBeUndefined();
  });
});
