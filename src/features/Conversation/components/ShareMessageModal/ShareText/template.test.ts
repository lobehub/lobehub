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

  it('should filter out loading messages', () => {
    const result = generateMarkdown(defaultParams);

    expect(result).not.toContain(LOADING_FLAT);
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

describe('generateMarkdown for a multi-step reply', () => {
  it('shares the text of every step, without the tool results', () => {
    const group = {
      children: [
        {
          content: 'Let me draw it.',
          id: 'step-1',
          tools: [
            {
              apiName: 'generate',
              arguments: '{}',
              id: 'call-1',
              identifier: 'image',
              result: { content: '{"url":"https://example.com/a.png"}', id: 'tool-1' },
              result_msg_id: 'tool-1',
              type: 'builtin',
            },
          ],
        },
        { content: 'Here is the picture.', id: 'step-2' },
      ],
      content: '',
      createdAt: Date.now(),
      id: 'step-1',
      role: 'assistantGroup',
      updatedAt: Date.now(),
    } as unknown as UIChatMessage;

    expect(generateMarkdown({ messages: [group] })).toBe('Let me draw it.\n\nHere is the picture.');
  });
});
