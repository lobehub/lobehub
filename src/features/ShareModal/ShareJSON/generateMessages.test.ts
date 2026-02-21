import { type UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { LOADING_FLAT } from '@/const/message';

import { generateMessages } from './generateMessages';

describe('generateMessages', () => {
  // 创建一些测试用的消息数据
  const mockMessages = [
    {
      id: '1',
      content: 'Hello',
      role: 'user',
      createdAt: Date.now(),
    },
    {
      id: '2',
      content: 'Hi there',
      role: 'assistant',
      createdAt: Date.now(),
    },
    {
      id: '3',
      content: LOADING_FLAT,
      role: 'assistant',
      createdAt: Date.now(),
    },
    {
      id: '4',
      content: 'Tool response',
      role: 'tool',
      createdAt: Date.now(),
      tool_call_id: 'tool1',
    },
  ] as UIChatMessage[];

  it('should filter out loading messages', () => {
    const result = generateMessages({
      messages: mockMessages,
      withSystemRole: false,
      includeTool: false,
      systemRole: '',
    });

    expect(result).toHaveLength(2);
    expect(result.some((m) => m.content === LOADING_FLAT)).toBeFalsy();
  });

  it('should include system role when withSystemRole is true and systemRole is provided', () => {
    const systemRole = 'I am a helpful assistant';
    const result = generateMessages({
      messages: mockMessages,
      withSystemRole: true,
      includeTool: false,
      systemRole,
    });

    expect(result[0]).toEqual({
      content: systemRole,
      role: 'system',
    });
    expect(result).toHaveLength(3); // system role + 2 messages
  });

  it('should not include system role when withSystemRole is false', () => {
    const systemRole = 'I am a helpful assistant';
    const result = generateMessages({
      messages: mockMessages,
      withSystemRole: false,
      includeTool: false,
      systemRole,
    });

    expect(result[0].role).not.toBe('system');
    expect(result).toHaveLength(2);
  });

  it('should include tool messages when includeTool is true', () => {
    const result = generateMessages({
      messages: mockMessages,
      withSystemRole: false,
      includeTool: true,
      systemRole: '',
    });

    expect(result).toHaveLength(3);
    expect(result.some((m) => m.role === 'tool')).toBeTruthy();
    expect((result.find((m) => m.role === 'tool')! as any).tool_call_id).toBeDefined();
  });

  it('should exclude tool messages when includeTool is false', () => {
    const result = generateMessages({
      messages: mockMessages,
      withSystemRole: false,
      includeTool: false,
      systemRole: '',
    });

    expect(result).toHaveLength(2);
    expect(result.some((m) => m.role === 'tool')).toBeFalsy();
  });

  it('should trim message content', () => {
    const messagesWithSpaces = [
      {
        id: '1',
        content: '  Hello  ',
        role: 'user',
        createdAt: Date.now(),
      },
    ] as UIChatMessage[];

    const result = generateMessages({
      messages: messagesWithSpaces,
      withSystemRole: false,
      includeTool: false,
      systemRole: '',
    });

    expect(result[0].content).toBe('Hello');
  });

  it('should not include system role when systemRole is empty', () => {
    const result = generateMessages({
      messages: mockMessages,
      withSystemRole: true,
      includeTool: false,
      systemRole: '',
    });

    expect(result).toHaveLength(2);
    expect(result[0].role).not.toBe('system');
  });
});
