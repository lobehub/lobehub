// @vitest-environment node
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

describe('archiveToolResultIfNeeded', () => {
  const db = {} as LobeChatDatabase;
  const mockVfsService = {
    mkdir: vi.fn(),
    write: vi.fn(),
  };
  const mockTopicDocumentModel = {
    associate: vi.fn(),
    isAssociated: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(AgentDocumentVfsService).mockImplementation(() => mockVfsService as any);
    vi.mocked(TopicDocumentModel).mockImplementation(() => mockTopicDocumentModel as any);
    mockVfsService.mkdir.mockResolvedValue({});
    mockVfsService.write.mockResolvedValue({ documentId: 'document-1', id: 'agent-doc-1' });
    mockTopicDocumentModel.isAssociated.mockResolvedValue(false);
    mockTopicDocumentModel.associate.mockResolvedValue({
      documentId: 'document-1',
      topicId: 'topic-1',
    });
  });

  it('returns unchanged content when it is under the limit', async () => {
    const result = await archiveToolResultIfNeeded({
      agentId: 'agent-1',
      content: 'short result',
      limit: 100,
      serverDB: db,
      toolCallId: 'call_1',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(result).toEqual({ archived: false, content: 'short result' });
    expect(AgentDocumentVfsService).not.toHaveBeenCalled();
  });

  it('archives oversized content and returns a truncated pointer', async () => {
    const result = await archiveToolResultIfNeeded({
      agentId: 'agent-1',
      content: '0123456789',
      limit: 5,
      serverDB: db,
      toolCallId: 'call_1',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(mockVfsService.mkdir).toHaveBeenCalledWith(
      './.tool-results',
      { agentId: 'agent-1', topicId: 'topic-1' },
      { recursive: true },
    );
    expect(mockVfsService.write).toHaveBeenCalledWith(
      './.tool-results/topic-1_call_1.txt',
      '0123456789',
      { agentId: 'agent-1', topicId: 'topic-1' },
    );
    expect(mockTopicDocumentModel.associate).toHaveBeenCalledWith({
      documentId: 'document-1',
      topicId: 'topic-1',
    });
    expect(result.archived).toBe(true);
    expect(result.archivePath).toBe('./.tool-results/topic-1_call_1.txt');
    expect(result.content).toContain('01234');
    expect(result.content).toContain('./.tool-results/topic-1_call_1.txt');
    expect(result.content).toContain('lobe-agent-documents');
    expect(result.content).toContain('readDocument');
    expect(result.content).toContain('agent-doc-1');
  });

  it('does not duplicate topic association when the archive document is already associated', async () => {
    mockTopicDocumentModel.isAssociated.mockResolvedValue(true);

    await archiveToolResultIfNeeded({
      agentId: 'agent-1',
      content: '0123456789',
      limit: 5,
      serverDB: db,
      toolCallId: 'call_1',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(mockTopicDocumentModel.associate).not.toHaveBeenCalled();
  });

  it('falls back to truncation without archive context', async () => {
    const result = await archiveToolResultIfNeeded({
      agentId: 'agent-1',
      content: '0123456789',
      limit: 5,
      toolCallId: 'call_1',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(result.archived).toBe(false);
    expect(result.archivePath).toBeUndefined();
    expect(result.content).toContain('01234');
    expect(result.content).toContain('Content truncated');
    expect(result.content).not.toContain('Archive failed');
    expect(AgentDocumentVfsService).not.toHaveBeenCalled();
  });

  it('bypasses archive entirely for lobe-agent-documents tool results', async () => {
    const result = await archiveToolResultIfNeeded({
      agentId: 'agent-1',
      content: 'x'.repeat(1000),
      identifier: 'lobe-agent-documents',
      limit: 5,
      serverDB: db,
      toolCallId: 'call_1',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(result.archived).toBe(false);
    expect(result.content).toBe('x'.repeat(1000));
    expect(AgentDocumentVfsService).not.toHaveBeenCalled();
  });

  it('keeps the tool result bounded when archive writing fails', async () => {
    mockVfsService.write.mockRejectedValue(new Error('write denied'));

    const result = await archiveToolResultIfNeeded({
      agentId: 'agent-1',
      content: '0123456789',
      limit: 5,
      serverDB: db,
      toolCallId: 'call_1',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(result.archived).toBe(false);
    expect(result.error).toBe('write denied');
    expect(result.content).toContain('01234');
    expect(result.content).toContain('Archive failed: write denied');
  });
});
