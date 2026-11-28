import { vi } from 'vitest';

export const createRuntimeMessageModelMock = () => ({
  create: vi.fn().mockResolvedValue({ id: 'msg-123' }),
  deleteMessage: vi.fn().mockResolvedValue({ success: true }),
  findByClientId: vi.fn().mockResolvedValue(undefined),
  // A persisted parent exists unless a test exercises the missing-parent path.
  findById: vi.fn().mockResolvedValue({ id: 'msg-existing' }),
  findMessagePlugin: vi.fn().mockResolvedValue(undefined),
  findToolMessageIdByToolCallId: vi.fn().mockResolvedValue(null),
  query: vi.fn().mockResolvedValue([]),
  update: vi.fn().mockResolvedValue({}),
  updateMessagePlugin: vi.fn().mockResolvedValue({ success: true }),
  updateToolMessage: vi.fn().mockResolvedValue({ success: true }),
});

export const withCompressionThread = (messages: Record<string, unknown>[]) =>
  messages.map((message) => ({ ...message, threadId: 'thread-123' }));

export const createRuntimeCost = () => ({
  calculatedAt: new Date().toISOString(),
  currency: 'USD',
  llm: {
    byModel: [],
    currency: 'USD',
    total: 0,
  },
  tools: {
    byTool: [],
    currency: 'USD',
    total: 0,
  },
  total: 0,
});
