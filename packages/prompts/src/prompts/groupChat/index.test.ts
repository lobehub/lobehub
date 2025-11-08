import type { UIChatMessage } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { filterMessagesForAgent } from '../chatMessages';
import { buildGroupChatSystemPrompt } from './index';

describe('buildGroupChatSystemPrompt', () => {
  const baseSystemRole = 'You are an expert collaborator.';
  const mockTimestamp = 1634567890000;

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(mockTimestamp);
  });

  const messages: UIChatMessage[] = [
    {
      id: 'm1',
      role: 'user',
      content: 'Hello everyone',
      createdAt: mockTimestamp,
      updatedAt: mockTimestamp,
      meta: {},
    },
    {
      id: 'm2',
      role: 'assistant',
      agentId: 'agent-1',
      content: 'Hi! I can help with that.',
      createdAt: mockTimestamp,
      updatedAt: mockTimestamp,
      meta: {},
    },
  ];

  it('should generate correct prompt with members and history', () => {
    const result = buildGroupChatSystemPrompt({
      agentId: 'agent-1',
      baseSystemRole,
      groupMembers: [
        { id: 'user', title: 'User Name' },
        { id: 'agent-1', title: 'Agent One' },
      ],
      messages,
    });

    expect(result).toMatchSnapshot();
  });

  it('should generate correct prompt without members and history', () => {
    const result = buildGroupChatSystemPrompt({
      agentId: 'agent-2',
      baseSystemRole,
      groupMembers: [],
      messages: [],
    });

    expect(result).toMatchSnapshot();
  });

  it('should include response instruction for group message', () => {
    const result = buildGroupChatSystemPrompt({
      agentId: 'agent-1',
      baseSystemRole,
      groupMembers: [{ id: 'agent-1', title: 'Agent One' }],
      messages,
    });

    expect(result).toContain("Now it's your turn to respond");
    expect(result).toContain('the group publicly');
  });

  it('should include response instruction for direct message', () => {
    const result = buildGroupChatSystemPrompt({
      agentId: 'agent-1',
      baseSystemRole,
      groupMembers: [{ id: 'agent-1', title: 'Agent One' }],
      messages,
      targetId: 'user',
    });

    expect(result).toContain("Now it's your turn to respond");
    expect(result).toContain('user');
  });

  it('should include supervisor instruction when provided', () => {
    const result = buildGroupChatSystemPrompt({
      agentId: 'agent-1',
      baseSystemRole,
      groupMembers: [{ id: 'agent-1', title: 'Agent One' }],
      messages,
      instruction: 'Please be concise',
    });

    expect(result).toContain('SUPERVISOR INSTRUCTION: Please be concise');
  });
});

describe('filterMessagesForAgent', () => {
  const mockTimestamp = 1634567890000;
  const agentId = 'agent-1';

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(mockTimestamp);
  });

  const createMessage = (
    id: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    options?: { agentId?: string; targetId?: string },
  ): UIChatMessage => ({
    id,
    role,
    content,
    createdAt: mockTimestamp,
    updatedAt: mockTimestamp,
    meta: {},
    ...options,
  });

  it('should handle system messages', () => {
    const messages = [createMessage('1', 'system', 'System message')];
    const result = filterMessagesForAgent(messages, agentId);
    expect(result).toMatchSnapshot();
  });

  it('should handle group messages without targetId', () => {
    const messages = [
      createMessage('1', 'user', 'Hello everyone'),
      createMessage('2', 'assistant', 'Hi there', { agentId: 'agent-2' }),
    ];
    const result = filterMessagesForAgent(messages, agentId);
    expect(result).toMatchSnapshot();
  });

  it('should handle user direct messages', () => {
    const messages = [
      createMessage('1', 'user', 'Private message to agent-1', { targetId: agentId }),
      createMessage('2', 'user', 'Private message to agent-2', { targetId: 'agent-2' }),
    ];
    const result = filterMessagesForAgent(messages, agentId);
    expect(result).toMatchSnapshot();
  });

  it('should handle assistant direct messages', () => {
    const messages = [
      createMessage('1', 'assistant', 'DM to agent-1', { agentId: 'agent-2', targetId: agentId }),
      createMessage('2', 'assistant', 'DM to agent-2', { agentId: 'agent-3', targetId: 'agent-2' }),
    ];
    const result = filterMessagesForAgent(messages, agentId);
    expect(result).toMatchSnapshot();
  });

  it('should handle messages sent by this agent', () => {
    const messages = [
      createMessage('1', 'assistant', 'My message to agent-2', { agentId, targetId: 'agent-2' }),
      createMessage('2', 'assistant', 'My group message', { agentId }),
      createMessage('3', 'assistant', 'Other agent message', {
        agentId: 'agent-2',
        targetId: 'agent-3',
      }),
    ];
    const result = filterMessagesForAgent(messages, agentId);
    expect(result).toMatchSnapshot();
  });

  it('should replace content for DMs not involving this agent', () => {
    const messages = [
      createMessage('1', 'user', 'Secret message', { targetId: 'agent-2' }),
      createMessage('2', 'assistant', 'Private response', { agentId: 'agent-2', targetId: 'user' }),
      createMessage('3', 'assistant', 'Agent to agent DM', {
        agentId: 'agent-2',
        targetId: 'agent-3',
      }),
    ];
    const result = filterMessagesForAgent(messages, agentId);
    expect(result).toMatchSnapshot();
  });

  it('should handle mixed message types', () => {
    const messages = [
      createMessage('1', 'system', 'System prompt'),
      createMessage('2', 'user', 'Hello everyone'),
      createMessage('3', 'assistant', 'Hi!', { agentId }),
      createMessage('4', 'user', 'DM to agent-1', { targetId: agentId }),
      createMessage('5', 'assistant', 'DM response', { agentId, targetId: 'user' }),
      createMessage('6', 'user', 'Secret to agent-2', { targetId: 'agent-2' }),
      createMessage('7', 'assistant', 'Secret response', { agentId: 'agent-2', targetId: 'user' }),
    ];
    const result = filterMessagesForAgent(messages, agentId);
    expect(result).toMatchSnapshot();
  });

  it('should preserve all message properties when replacing content', () => {
    const originalMessage = createMessage('1', 'user', 'Secret message', { targetId: 'agent-2' });
    originalMessage.files = ['file1'];
    originalMessage.tools = [];
    originalMessage.parentId = 'parent1';
    originalMessage.observationId = 'obs1';

    const result = filterMessagesForAgent([originalMessage], agentId);
    expect(result).toMatchSnapshot();
  });
});
