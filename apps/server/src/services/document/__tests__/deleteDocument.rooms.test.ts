import { type LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';

import { dropPageRooms } from '../../pageCollab/notify';
import { DocumentService } from '../index';

vi.mock('@/server/modules/AgentRuntime/redis', () => ({ getAgentRuntimeRedisClient: () => null }));
vi.mock('@/database/models/document');
vi.mock('@/database/models/file');
vi.mock('@/database/models/knowledgeBase');
vi.mock('../../file');
vi.mock('../history');
vi.mock('../../pageCollab/notify', () => ({ dropPageRooms: vi.fn() }));

describe('DocumentService.deleteDocument — collaboration rooms', () => {
  const documentModel = { delete: vi.fn(), findById: vi.fn() };

  beforeEach(() => {
    vi.mocked(dropPageRooms).mockClear();
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

  it('drops the collaboration room of a deleted workspace page', async () => {
    documentModel.findById.mockResolvedValue({
      fileId: null,
      fileType: 'custom/document',
      id: 'doc-1',
      workspaceId: 'ws-1',
    });

    await new DocumentService({} as LobeChatDatabase, 'user-1', 'ws-1').deleteDocument('doc-1');

    expect(vi.mocked(dropPageRooms)).toHaveBeenCalledWith(['doc-1']);
  });

  it('leaves rooms alone when deleting a personal page', async () => {
    documentModel.findById.mockResolvedValue({
      fileId: null,
      fileType: 'custom/document',
      id: 'doc-1',
      workspaceId: null,
    });

    await new DocumentService({} as LobeChatDatabase, 'user-1').deleteDocument('doc-1');

    expect(vi.mocked(dropPageRooms)).not.toHaveBeenCalled();
  });
});
