import { beforeEach, expect, it, vi } from 'vitest';

import { revokedContextSources } from './index';

const mocks = vi.hoisted(() => ({
  document: vi.fn(),
  file: vi.fn(),
  topic: vi.fn(),
  memory: vi.fn(),
  topicConstructor: vi.fn(),
}));
vi.mock('@/server/services/agentDocuments', () => ({
  AgentDocumentsService: class {
    getDocumentById = mocks.document;
  },
}));
vi.mock('@/database/models/file', () => ({
  FileModel: class {
    findById = mocks.file;
  },
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    constructor(...args: unknown[]) {
      mocks.topicConstructor(...args);
    }
    findById = mocks.topic;
  },
}));
vi.mock('@/database/models/userMemory/context', () => ({
  UserMemoryContextModel: class {
    findById = mocks.memory;
  },
}));
vi.mock('@/server/routers/lambda/_helpers/conversationResourceGuard', () => ({
  assertCanViewMessageTargets: vi.fn(),
  assertCanViewTopicTargets: vi.fn(),
}));
const ctx = { db: {} as never, userId: 'owner', agentId: 'agent' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.document.mockResolvedValue({ id: 'doc', accessSelf: 0 });
  mocks.memory.mockResolvedValue(undefined);
});
it('revokes a bound document when READ is removed without deleting its binding', async () => {
  expect(await revokedContextSources(ctx, ['document:doc'])).toEqual(['document:doc']);
});
it('validates the exact historical memory item even while other memories remain enabled', async () => {
  expect(await revokedContextSources(ctx, ['memory:contexts:deleted'])).toEqual([
    'memory:contexts:deleted',
  ]);
  expect(mocks.memory).toHaveBeenCalledWith('deleted');
});
it('uses the trusted visitor scope for a file and its own shared topic', async () => {
  const shareVisitor = { shareId: 'share', visitorUserId: 'visitor', agentId: 'agent' } as never;
  mocks.file.mockResolvedValue({ id: 'upload' });
  mocks.topic.mockResolvedValue({ id: 'topic', senderId: 'visitor', agentId: 'agent' });
  expect(
    await revokedContextSources({ ...ctx, shareVisitor }, ['file:upload', 'topic:topic']),
  ).toEqual([]);
  expect(mocks.file).toHaveBeenCalledWith('upload', {
    accessScope: { type: 'agentShare', shareId: 'share', visitorUserId: 'visitor' },
  });
  expect(mocks.topicConstructor.mock.calls.at(-1)?.[4]).toEqual({ includeShareVisitor: true });
  mocks.topic.mockResolvedValue({ senderId: 'someone-else', agentId: 'agent' });
  expect(await revokedContextSources({ ...ctx, shareVisitor }, ['topic:topic'])).toEqual([
    'topic:topic',
  ]);
});
