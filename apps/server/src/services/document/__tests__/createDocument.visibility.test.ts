import { type LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';

import { DocumentService } from '../index';

vi.mock('@/server/modules/AgentRuntime/redis', () => ({ getAgentRuntimeRedisClient: () => null }));
vi.mock('@/database/models/document');
vi.mock('@/database/models/file');
vi.mock('@/database/models/knowledgeBase');
vi.mock('../../file');
vi.mock('../history');

describe('DocumentService.createDocument — workspace visibility default', () => {
  const documentModel = { create: vi.fn().mockResolvedValue({ id: 'doc-1' }) };

  beforeEach(() => {
    vi.mocked(DocumentModel).mockImplementation(function () {
      return documentModel as any;
    });
    vi.mocked(FileModel).mockImplementation(function () {
      return {} as any;
    });
    vi.mocked(KnowledgeBaseModel).mockImplementation(function () {
      return {} as any;
    });
  });

  it('leaves a standalone workspace page to the public schema default', async () => {
    // An agent writing through `lh doc create` passes no visibility; the page
    // must land in the workspace, not in the caller's private space.
    const service = new DocumentService({} as LobeChatDatabase, 'user-1', 'ws-1');
    await service.createDocument({ editorData: {}, title: 'Agent Report' });

    expect(documentModel.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ visibility: 'private' }),
    );
  });

  it('keeps an explicit private visibility', async () => {
    const service = new DocumentService({} as LobeChatDatabase, 'user-1', 'ws-1');
    await service.createDocument({ editorData: {}, title: 'Draft', visibility: 'private' });

    expect(documentModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'private' }),
    );
  });
});
