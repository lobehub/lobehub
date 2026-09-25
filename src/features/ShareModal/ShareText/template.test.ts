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

  it('should normalize a leading think tag before exporting markdown', () => {
    const messagesWithThinkTags = [
      {
        id: '1',
        content: '<think>Reasoning</think>Outro',
        role: 'assistant',
        createdAt: Date.now(),
      },
    ] as UIChatMessage[];

    const result = generateMarkdown({
      ...defaultParams,
      messages: messagesWithThinkTags,
    });

    expect(result).toContain('<think>\n\nReasoning\n\n</think>\n\nOutro');
  });

  it('should keep a mid-message think tag untouched when exporting markdown', () => {
    const messagesWithThinkTags = [
      {
        id: '1',
        content: 'Intro<think>Reasoning</think>Outro',
        role: 'assistant',
        createdAt: Date.now(),
      },
    ] as UIChatMessage[];

    const result = generateMarkdown({
      ...defaultParams,
      messages: messagesWithThinkTags,
    });

    expect(result).toContain('Intro<think>Reasoning</think>Outro');
  });
});

describe('generateMarkdown with virtual assistant messages', () => {
  // `parse()` empties `content` on virtual rows and moves the authored text into
  // `children` / `taskCompletions` / `tasks`, which is why the Text and PDF exports
  // used to render those turns as blank lines. See #19970.
  const virtualParams = {
    title: 'Chat Title',
    includeTool: false,
    includeUser: true,
    withSystemRole: false,
    withRole: true,
    systemRole: '',
  };

  const toolCall = { id: 'tool_1', identifier: 'search' };

  const toolCallingGroup = [
    {
      children: [
        { content: 'Searching for that now', id: 'child-1', tools: [toolCall] },
        { content: 'It is 22C and sunny.', id: 'child-2' },
      ],
      content: '',
      createdAt: 2,
      id: 'group-1',
      role: 'assistantGroup',
    },
  ] as UIChatMessage[];

  it('should export the authored answer of a tool-calling assistant group', () => {
    const messages = [
      { content: 'What is the weather?', createdAt: 1, id: 'user-1', role: 'user' },
      ...toolCallingGroup,
    ] as UIChatMessage[];

    const result = generateMarkdown({ ...virtualParams, messages });

    expect(result).toContain('##### User:');
    expect(result).toContain('##### Assistant:');
    expect(result).toContain('It is 22C and sunny.');
  });

  it('should export the authored answer of a supervisor group', () => {
    const messages = [
      {
        children: [{ content: 'The supervisor conclusion.', id: 'child-1' }],
        content: '',
        createdAt: 1,
        id: 'sup-1',
        role: 'supervisor',
      },
    ] as UIChatMessage[];

    const result = generateMarkdown({ ...virtualParams, messages });

    expect(result).toContain('##### Assistant:');
    expect(result).toContain('The supervisor conclusion.');
  });

  it('should join the payload of a virtual tasks message', () => {
    const messages = [
      {
        content: '',
        createdAt: 1,
        id: 'tasks-1',
        role: 'tasks',
        tasks: [
          { content: 'Step one finished.', createdAt: 1, id: 't1', role: 'task' },
          { content: 'Step two finished.', createdAt: 2, id: 't2', role: 'task' },
        ],
      },
    ] as UIChatMessage[];

    const result = generateMarkdown({ ...virtualParams, messages });

    expect(result).toContain('##### Assistant:');
    expect(result).toContain('Step one finished.');
    expect(result).toContain('Step two finished.');
  });

  it('should not leak tool call JSON by default but still export the prose', () => {
    const result = generateMarkdown({ ...virtualParams, messages: toolCallingGroup });

    expect(result).toContain('It is 22C and sunny.');
    expect(result).not.toContain('"identifier"');
  });

  it('should still export the prose when tool calls are included', () => {
    const result = generateMarkdown({
      ...virtualParams,
      includeTool: true,
      messages: toolCallingGroup,
    });

    expect(result).toContain('It is 22C and sunny.');
  });

  it('should skip a virtual assistant row that has no authored content', () => {
    const messages = [
      { content: 'What is the weather?', createdAt: 1, id: 'user-1', role: 'user' },
      {
        children: [{ content: '', id: 'child-1', tools: [toolCall] }],
        content: '',
        createdAt: 2,
        id: 'group-1',
        role: 'assistantGroup',
      },
    ] as UIChatMessage[];

    const result = generateMarkdown({ ...virtualParams, messages });

    expect(result).toBe('# Chat Title\n\n\n##### User:\n\nWhat is the weather?');
  });

  it('should keep plain assistant messages unchanged', () => {
    const messages = [
      { content: 'Hi there', createdAt: 1, id: 'a-1', role: 'assistant' },
    ] as UIChatMessage[];

    const result = generateMarkdown({ ...virtualParams, messages });

    expect(result).toContain('##### Assistant:');
    expect(result).toContain('Hi there');
  });
});
