import { type LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';

import { DocumentService } from '../index';

const lock = vi.hoisted(() => ({ canWrite: vi.fn() }));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({ getAgentRuntimeRedisClient: () => null }));
vi.mock('@/database/models/document');
vi.mock('@/database/models/file');
vi.mock('@/database/models/knowledgeBase');
vi.mock('../../file');
vi.mock('../history');
vi.mock('../../editLock', () => ({
  EditLockService: class {
    canWrite = lock.canWrite;
  },
}));

describe('DocumentService.assertCanWriteBody', () => {
  const documentModel = { findById: vi.fn() };

  beforeEach(() => {
    lock.canWrite.mockReset();
    documentModel.findById.mockResolvedValue({ visibility: 'public', workspaceId: 'ws-1' });
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

  const service = () => new DocumentService({} as LobeChatDatabase, 'user-1', 'ws-1');

  it('refuses a workspace page whose lock another session holds', async () => {
    lock.canWrite.mockResolvedValue(false);

    await expect(service().assertCanWriteBody('doc-1', 'page:doc-1:b')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(lock.canWrite).toHaveBeenCalledWith('document', 'doc-1', 'page:doc-1:b');
  });

  it('allows the session that holds the lock', async () => {
    lock.canWrite.mockResolvedValue(true);

    await expect(service().assertCanWriteBody('doc-1', 'page:doc-1:b')).resolves.toBeUndefined();
  });

  it('skips the lock on a private page, which has no collaborators', async () => {
    documentModel.findById.mockResolvedValue({ visibility: 'private', workspaceId: 'ws-1' });

    await expect(service().assertCanWriteBody('doc-1', 'page:doc-1:b')).resolves.toBeUndefined();
    expect(lock.canWrite).not.toHaveBeenCalled();
  });
});
