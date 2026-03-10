import { type UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { LOADING_FLAT } from '@/const/message';

import { generateMarkdown } from './template';

describe('generateMarkdown', () => {
  // 创建测试用的消息数据
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
      content: '{"result": "tool data"}',
      role: 'tool',
      createdAt: Date.now(),
      tool_call_id: 'tool1',
    },
    {
      id: '5',
      content: 'Message with tools',
      role: 'assistant',
      createdAt: Date.now(),
      tools: [{ name: 'calculator', result: '42' }],
    },
  ] as UIChatMessage[];

  const defaultParams = {
    messages: mockMessages,
    title: 'Chat Title',
    includeTool: false,
    includeUser: true,
    withSystemRole: false,
    withRole: false,
    systemRole: '',
  };

  it('should generate basic markdown with title', () => {
    const result = generateMarkdown(defaultParams);

    expect(result).toContain('# Chat Title');
    expect(result).toContain('Hello');
    expect(result).toContain('Hi there');
  });

  it('should include system role when withSystemRole is true', () => {
    const systemRole = 'I am a helpful assistant';
    const result = generateMarkdown({
      ...defaultParams,
      withSystemRole: true,
      systemRole,
    });

    expect(result).toContain('````md\nI am a helpful assistant\n````');
  });

  it('should not include system role when withSystemRole is false', () => {
    const systemRole = 'I am a helpful assistant';
    const result = generateMarkdown({
      ...defaultParams,
      withSystemRole: false,
      systemRole,
    });

    expect(result).not.toContain('```\nI am a helpful assistant\n```');
  });

  it('should add role labels when withRole is true', () => {
    const result = generateMarkdown({
      ...defaultParams,
      withRole: true,
    });

    expect(result).toContain('##### User:');
    expect(result).toContain('##### Assistant:');
  });

  it('should not add role labels when withRole is false', () => {
    const result = generateMarkdown({
      ...defaultParams,
      withRole: false,
    });

    expect(result).not.toContain('##### User:');
    expect(result).not.toContain('##### Assistant:');
  });

  it('should include tool messages when includeTool is true', () => {
    const result = generateMarkdown({
      ...defaultParams,
      includeTool: true,
      withRole: true,
    });

    expect(result).toContain('##### Tools Calling:');
    expect(result).toContain('```json\n{"result": "tool data"}\n```');
  });

  it('should exclude tool messages when includeTool is false', () => {
    const result = generateMarkdown({
      ...defaultParams,
      includeTool: false,
    });

    expect(result).not.toContain('{"result": "tool data"}');
  });

  it('should exclude user messages when includeUser is false', () => {
    const result = generateMarkdown({
      ...defaultParams,
      includeUser: false,
    });

    expect(result).not.toContain('Hello');
    expect(result).toContain('Hi there');
  });

  it('should filter out loading messages', () => {
    const result = generateMarkdown(defaultParams);

    expect(result).not.toContain(LOADING_FLAT);
  });

  it('should include tools data when includeTool is true', () => {
    const result = generateMarkdown({
      ...defaultParams,
      includeTool: true,
    });

    expect(result).toContain('"name": "calculator"');
    expect(result).toContain('"result": "42"');
  });

  it('should handle empty messages array', () => {
    const result = generateMarkdown({
      ...defaultParams,
      messages: [],
    });

    expect(result).toContain('# Chat Title');
    // Should not throw error and should contain at least the title
  });

  it('should handle messages with special characters', () => {
    const messagesWithSpecialChars = [
      {
        id: '1',
        content: '**Bold** *Italic* `Code`',
        role: 'user',
        createdAt: Date.now(),
      },
    ] as UIChatMessage[];

    const result = generateMarkdown({
      ...defaultParams,
      messages: messagesWithSpecialChars,
    });

    expect(result).toContain('**Bold** *Italic* `Code`');
  });
});
