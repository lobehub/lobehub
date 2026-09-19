// @vitest-environment node
import { createHash } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TopicDocumentModel } from '@/database/models/topicDocument';
import { AgentDocumentVfsService } from '@/server/services/agentDocumentVfs';

import { archiveToolResultIfNeeded } from '../archiveToolResult';

vi.mock('@/server/services/agentDocumentVfs', () => ({
  AgentDocumentVfsService: vi.fn(),
}));

vi.mock('@/database/models/topicDocument', () => ({
  TopicDocumentModel: vi.fn(),
}));

const CONTENT = '0123456789';
const CONTENT_HASH = createHash('sha256').update(CONTENT).digest('hex').slice(0, 32);
const ARCHIVE_PATH = `./.tool-results/${CONTENT_HASH}.txt`;

describe('archiveToolResultIfNeeded', () => {
  const tx = { execute: vi.fn() };
  const db = {
    transaction: vi.fn(async (callback: (trx: unknown) => Promise<unknown>) => callback(tx)),
  } as unknown as LobeChatDatabase;
  const mockVfsService = {
    mkdir: vi.fn(),
    read: vi.fn(),
    stat: vi.fn(),
    write: vi.fn(),
  };
  const mockTopicDocumentModel = {
    associate: vi.fn(),
    isAssociated: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(AgentDocumentVfsService).mockImplementation(function () {
      return mockVfsService as any;
    });
    vi.mocked(TopicDocumentModel).mockImplementation(function () {
      return mockTopicDocumentModel as any;
    });
    tx.execute.mockResolvedValue(undefined);
    mockVfsService.mkdir.mockResolvedValue({});
    mockVfsService.stat.mockResolvedValue(undefined);
    mockVfsService.read.mockResolvedValue({ content: CONTENT });
    mockVfsService.write.mockResolvedValue({ documentId: 'document-1', id: 'agent-doc-1' });
    mockTopicDocumentModel.isAssociated.mockResolvedValue(false);
    mockTopicDocumentModel.associate.mockResolvedValue({
      documentId: 'document-1',
      topicId: 'topic-1',
    });
  });

  const archive = (overrides: Partial<Parameters<typeof archiveToolResultIfNeeded>[0]> = {}) =>
    archiveToolResultIfNeeded({
      agentId: 'agent-1',
      content: CONTENT,
      limit: 5,
      serverDB: db,
      toolCallId: 'call_1',
      topicId: 'topic-1',
      userId: 'user-1',
      ...overrides,
    });

  it('returns unchanged content when it is under the limit', async () => {
    const result = await archive({ content: 'short result', limit: 100 });

    expect(result).toEqual({ archived: false, content: 'short result' });
    expect(AgentDocumentVfsService).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('archives oversized content under a content-hash path and returns a truncated pointer', async () => {
    const result = await archive();

    expect(mockVfsService.mkdir).toHaveBeenCalledWith(
      './.tool-results',
      { agentId: 'agent-1', topicId: 'topic-1' },
      { recursive: true },
    );
    expect(mockVfsService.stat).toHaveBeenCalledWith(ARCHIVE_PATH, {
      agentId: 'agent-1',
      topicId: 'topic-1',
    });
    expect(mockVfsService.write).toHaveBeenCalledWith(
      ARCHIVE_PATH,
      CONTENT,
      { agentId: 'agent-1', topicId: 'topic-1' },
      { contentFormat: 'raw' },
    );
    expect(mockVfsService.read).toHaveBeenCalledWith(ARCHIVE_PATH, {
      agentId: 'agent-1',
      topicId: 'topic-1',
    });
    expect(mockTopicDocumentModel.associate).toHaveBeenCalledWith({
      documentId: 'document-1',
      topicId: 'topic-1',
    });
    expect(result.archived).toBe(true);
    expect(result.archivePath).toBe(ARCHIVE_PATH);
    expect(result.content).toContain('01234');
    expect(result.content).toContain(ARCHIVE_PATH);
    expect(result.content).toContain('lobe-agent-documents');
    expect(result.content).toContain('readDocument');
    expect(result.content).toContain('agent-doc-1');
  });

  it('serializes archive writes per agent with a transaction-scoped advisory lock', async () => {
    await archive();

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(tx.execute).toHaveBeenCalledTimes(1);
    const [query] = tx.execute.mock.calls[0];
    expect(JSON.stringify(query)).toContain('pg_advisory_xact_lock');
    expect(JSON.stringify(query)).toContain('toolResultArchive:agent-1');
    // Every VFS / topic-document write must run on the locked transaction handle.
    expect(vi.mocked(AgentDocumentVfsService).mock.calls[0][0]).toBe(tx);
    expect(vi.mocked(TopicDocumentModel).mock.calls[0][0]).toBe(tx);
  });

  it('reuses an existing archive with identical content instead of writing a new document', async () => {
    mockVfsService.stat.mockResolvedValue({
      documentId: 'document-existing',
      id: 'agent-doc-existing',
      type: 'file',
    });

    const result = await archive({ toolCallId: 'call_2', topicId: 'topic-2' });

    expect(mockVfsService.write).not.toHaveBeenCalled();
    expect(mockVfsService.read).toHaveBeenCalledWith(ARCHIVE_PATH, {
      agentId: 'agent-1',
      topicId: 'topic-2',
    });
    expect(mockTopicDocumentModel.associate).toHaveBeenCalledWith({
      documentId: 'document-existing',
      topicId: 'topic-2',
    });
    expect(result.archived).toBe(true);
    expect(result.archivePath).toBe(ARCHIVE_PATH);
    expect(result.content).toContain('agent-doc-existing');
  });

  it('falls back to a per-call path when the hash path holds different content', async () => {
    mockVfsService.stat.mockResolvedValue({
      documentId: 'document-other',
      id: 'agent-doc-other',
      type: 'file',
    });
    mockVfsService.read
      .mockResolvedValueOnce({ content: 'something else' })
      .mockResolvedValueOnce({ content: CONTENT });

    const collisionPath = `./.tool-results/${CONTENT_HASH}_call_1.txt`;
    const result = await archive();

    expect(mockVfsService.write).toHaveBeenCalledWith(
      collisionPath,
      CONTENT,
      { agentId: 'agent-1', topicId: 'topic-1' },
      { contentFormat: 'raw' },
    );
    expect(mockTopicDocumentModel.associate).toHaveBeenCalledWith({
      documentId: 'document-1',
      topicId: 'topic-1',
    });
    expect(result.archived).toBe(true);
    expect(result.archivePath).toBe(collisionPath);
  });

  it('does not duplicate topic association when the archive document is already associated', async () => {
    mockTopicDocumentModel.isAssociated.mockResolvedValue(true);

    await archive();

    expect(mockTopicDocumentModel.associate).not.toHaveBeenCalled();
  });

  it('fails closed when the persisted archive content does not match the tool result', async () => {
    mockVfsService.read.mockResolvedValue({ content: 'corrupted' });

    const result = await archive();

    expect(result.archived).toBe(false);
    expect(result.error).toBe('Archived content verification failed');
    expect(result.content).toContain('Archive failed: Archived content verification failed');
    expect(mockTopicDocumentModel.associate).not.toHaveBeenCalled();
  });

  it('falls back to truncation without archive context', async () => {
    const result = await archive({ serverDB: undefined });

    expect(result.archived).toBe(false);
    expect(result.archivePath).toBeUndefined();
    expect(result.content).toContain('01234');
    expect(result.content).toContain('Content truncated');
    expect(result.content).not.toContain('Archive failed');
    expect(AgentDocumentVfsService).not.toHaveBeenCalled();
  });

  it('bypasses archive entirely for lobe-agent-documents tool results', async () => {
    const result = await archive({ content: 'x'.repeat(1000), identifier: 'lobe-agent-documents' });

    expect(result.archived).toBe(false);
    expect(result.content).toBe('x'.repeat(1000));
    expect(AgentDocumentVfsService).not.toHaveBeenCalled();
  });

  it('keeps the tool result bounded when archive writing fails', async () => {
    mockVfsService.write.mockRejectedValue(new Error('write denied'));

    const result = await archive();

    expect(result.archived).toBe(false);
    expect(result.error).toBe('write denied');
    expect(result.archivePath).toBe(ARCHIVE_PATH);
    expect(result.content).toContain('01234');
    expect(result.content).toContain('Archive failed: write denied');
  });
});
