import { type ChatTopic, type UIChatMessage } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { LOADING_FLAT } from '@/const/message';

import { generateFullExport } from './generateFullExport';

describe('generateFullExport', () => {
  const mockMessages = [
    {
      id: 'msg-1',
      content: 'Hello',
      role: 'user',
      parentId: null,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      model: null,
      provider: null,
    },
    {
      id: 'msg-2',
      content: 'Hi there!',
      role: 'assistant',
      parentId: 'msg-1',
      createdAt: 1700000001000,
      updatedAt: 1700000001000,
      model: 'gpt-4',
      provider: 'openai',
    },
    {
      id: 'msg-3',
      content: LOADING_FLAT,
      role: 'assistant',
      parentId: 'msg-2',
      createdAt: 1700000002000,
      updatedAt: 1700000002000,
    },
  ] as UIChatMessage[];

  const mockTopic: ChatTopic = {
    id: 'topic-1',
    title: 'Test Topic',
    favorite: true,
    createdAt: 1700000000000,
    updatedAt: 1700000003000,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should export messages with correct structure', () => {
    const result = generateFullExport({
      messages: mockMessages,
      withSystemRole: false,
      includeTool: false,
      systemRole: '',
    });

    expect(result.version).toBe('2.0');
    expect(result.exportedAt).toBe('2024-01-01T00:00:00.000Z');
    expect(result.messages).toHaveLength(2); // Excluding loading message
  });

  it('should include topic title when provided', () => {
    const result = generateFullExport({
      messages: mockMessages,
      withSystemRole: false,
      includeTool: false,
      systemRole: '',
      topic: mockTopic,
    });

    expect(result.title).toBe('Test Topic');
  });

  it('should not include title when topic not provided', () => {
    const result = generateFullExport({
      messages: mockMessages,
      withSystemRole: false,
      includeTool: false,
      systemRole: '',
    });

    expect(result.title).toBeUndefined();
  });

  it('should include system role message when withSystemRole is true', () => {
    const systemRole = 'I am a helpful assistant';
    const result = generateFullExport({
      messages: mockMessages,
      withSystemRole: true,
      includeTool: false,
      systemRole,
    });

    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toBe(systemRole);
    expect(result.messages[0].id).toBe('system-role');
    // system role message doesn't have parentId field
    expect(result.messages[0].parentId).toBeUndefined();
  });

  it('should preserve message metadata', () => {
    const result = generateFullExport({
      messages: mockMessages,
      withSystemRole: false,
      includeTool: false,
      systemRole: '',
    });

    const userMessage = result.messages.find((m) => m.id === 'msg-1');
    const assistantMessage = result.messages.find((m) => m.id === 'msg-2');

    // parentId is cleaned when null (cleanObject removes null values)
    expect(userMessage?.parentId).toBeUndefined();
    expect(assistantMessage?.parentId).toBe('msg-1');
    expect(assistantMessage?.model).toBe('gpt-4');
    expect(assistantMessage?.provider).toBe('openai');
  });

  it('should convert timestamps to ISO format', () => {
    const result = generateFullExport({
      messages: mockMessages,
      withSystemRole: false,
      includeTool: false,
      systemRole: '',
    });

    const message = result.messages[0];
    expect(message.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    expect(message.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
  });

  it('should filter out loading messages', () => {
    const result = generateFullExport({
      messages: mockMessages,
      withSystemRole: false,
      includeTool: false,
      systemRole: '',
    });

    expect(result.messages.some((m) => m.content === LOADING_FLAT)).toBeFalsy();
  });
});

it.each([false, true])(
  'preserves usage metadata only for opted-in full exports (%s)',
  (visible) => {
    const metadata = {
      performance: { tps: 777, ttft: 42 },
      usage: { cost: 0.31, totalTokens: 543 },
    };
    const message = {
      content: '543 remains in user text',
      createdAt: 0,
      id: 'm',
      metadata,
      role: 'assistant',
      updatedAt: 0,
    } as UIChatMessage;
    const result = generateFullExport({
      includeTool: true,
      messages: [message],
      showMemberTokenUsage: visible,
      systemRole: '',
      withSystemRole: false,
    });
    expect(result.messages[0].metadata).toEqual(
      visible ? metadata : { performance: { ttft: 42 }, usage: { cost: 0.31 } },
    );
    expect(result.messages[0].content).toBe(message.content);
  },
);

it.each([false, true])(
  'gates both live and final built-in sub-agent tool stats (%s)',
  (visible) => {
    const stats = {
      totalCost: 0.31,
      totalInputTokens: 121,
      totalOutputTokens: 422,
      totalTokens: 543,
    };
    const state = { ...stats, progress: stats, threadId: 'thread' };
    const message = {
      content: 'result',
      createdAt: 0,
      id: 'tool',
      plugin: { apiName: 'callSubAgent', identifier: 'lobe-agent' },
      pluginState: state,
      role: 'tool',
      updatedAt: 0,
    } as UIChatMessage;
    const result = generateFullExport({
      includeTool: true,
      messages: [message],
      showMemberTokenUsage: visible,
      systemRole: '',
      withSystemRole: false,
    });
    expect(result.messages[0].pluginState).toEqual(
      visible ? state : { progress: { totalCost: 0.31 }, threadId: 'thread', totalCost: 0.31 },
    );
  },
);
