import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  chatHistoryPrompts,
  consolidateGroupChatHistory,
  groupMemeberSpeakingPrompts,
  groupSupervisorPrompts,
} from './index';

let messageCounter = 0;
const createMessage = (
  overrides: Partial<UIChatMessage> & Pick<UIChatMessage, 'role' | 'content'>,
): UIChatMessage => ({
  id: overrides.id ?? `msg-${++messageCounter}`,
  createdAt: overrides.createdAt ?? 0,
  updatedAt: overrides.updatedAt ?? 0,
  ...overrides,
});

describe('chatHistoryPrompts', () => {
  // Test with empty messages array
  it('should return empty chat history with empty messages', () => {
    const messages: UIChatMessage[] = [];
    const result = chatHistoryPrompts(messages);

    expect(result).toBe(`<chat_history>

</chat_history>`);
  });

  // Test with single message
  it('should format single message correctly', () => {
    const messages = [
      {
        role: 'user',
        content: 'Hello',
      },
    ] as UIChatMessage[];
    const result = chatHistoryPrompts(messages);

    expect(result).toBe(`<chat_history>
<user>Hello</user>
</chat_history>`);
  });

  // Test with multiple messages
  it('should format multiple messages correctly', () => {
    const messages = [
      {
        role: 'user',
        content: 'Hello',
      },
      {
        role: 'assistant',
        content: 'Hi there!',
      },
      {
        role: 'user',
        content: 'How are you?',
      },
    ] as UIChatMessage[];
    const result = chatHistoryPrompts(messages);

    expect(result).toBe(`<chat_history>
<user>Hello</user>
<assistant>Hi there!</assistant>
<user>How are you?</user>
</chat_history>`);
  });

  // Test with messages containing special characters
  it('should handle messages with special characters', () => {
    const messages = [
      {
        role: 'user',
        content: 'Hello & goodbye',
      },
      {
        role: 'assistant',
        content: '<test> & </test>',
      },
    ] as UIChatMessage[];

    const result = chatHistoryPrompts(messages);

    expect(result).toBe(`<chat_history>
<user>Hello & goodbye</user>
<assistant><test> & </test></assistant>
</chat_history>`);
  });

  // Test with messages containing multiple lines
  it('should handle multi-line messages correctly', () => {
    const messages = [
      {
        role: 'user',
        content: 'Line 1\nLine 2',
      },
    ] as UIChatMessage[];

    const result = chatHistoryPrompts(messages);

    expect(result).toBe(`<chat_history>
<user>Line 1\nLine 2</user>
</chat_history>`);
  });
});

describe('groupSupervisorPrompts', () => {
  it('should format messages and exclude supervisor role', () => {
    const messages: UIChatMessage[] = [
      createMessage({ role: 'user', content: 'Hello everyone' }),
      createMessage({ role: 'assistant', agentId: 'agent-1', content: 'Reporting in' }),
      createMessage({
        role: 'assistant',
        agentId: 'agent-2',
        targetId: 'agent-1',
        content: 'Private update',
      }),
      createMessage({ role: 'supervisor', content: 'Ignore this' }),
      createMessage({ role: 'assistant', content: 'General update' }),
    ];

    const result = groupSupervisorPrompts(messages);

    expect(result).toBe(
      `<message author="user">Hello everyone</message>
<message author="agent-1">Reporting in</message>
<message author="agent-2" target="agent-1">Private update</message>
<message author="assistant">General update</message>`,
    );
  });
});

describe('groupMemeberSpeakingPrompts', () => {
  it('should wrap messages in chat_group tags', () => {
    const messages: UIChatMessage[] = [
      createMessage({ role: 'user', content: 'Need assistance' }),
      createMessage({ role: 'assistant', content: 'On it!' }),
    ];

    const result = groupMemeberSpeakingPrompts(messages);

    expect(result).toBe(`<chat_group>
<user>Need assistance</user>
<assistant>On it!</assistant>
</chat_group>`);
  });
});

describe('consolidateGroupChatHistory', () => {
  it('should return empty string for no messages', () => {
    expect(consolidateGroupChatHistory([])).toBe('');
  });

  it('should format messages with agent titles and default labels', () => {
    const messages: UIChatMessage[] = [
      createMessage({ role: 'assistant', content: '   ' }), // filtered out
      createMessage({ role: 'user', content: 'Hello group' }),
      createMessage({ role: 'assistant', agentId: 'agent-1', content: 'Status update' }),
      createMessage({ role: 'assistant', agentId: 'agent-2', content: 'Additional info' }),
      createMessage({ role: 'assistant', content: 'General response' }),
    ];

    const agents = [{ id: 'agent-1', title: 'Researcher' }];

    const result = consolidateGroupChatHistory(messages, agents);

    expect(result).toBe(`(User): Hello group
(Researcher): Status update
(Agent agent-2): Additional info
(Assistant): General response`);
  });
});
