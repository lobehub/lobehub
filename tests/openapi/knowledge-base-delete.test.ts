import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';
import { FileService } from '@/server/services/file';

import { KnowledgeBaseService } from '../../packages/openapi/src/services/knowledge-base.service';

vi.mock('@/server/services/file');

describe('KnowledgeBaseService.deleteKnowledgeBase', () => {
  let db: LobeChatDatabase;
  let deleteFilesSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = {
      query: {
        knowledgeBases: {
          findFirst: vi.fn().mockResolvedValue({ id: 'kb-1', userId: 'user-1' }),
        },
      },
    } as unknown as LobeChatDatabase;

    deleteFilesSpy = vi.fn().mockResolvedValue(undefined);
    vi.mocked(FileService).mockImplementation(() => ({ deleteFiles: deleteFilesSpy }) as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createService = () => {
    const service = new KnowledgeBaseService(db, 'user-1');

    vi.spyOn(service as any, 'log').mockImplementation(() => {});
    vi.spyOn(service as any, 'resolveOperationPermission').mockResolvedValue({
      isPermitted: true,
      message: '',
    });

    return service;
  };

  it('should always delete exclusive files together with the knowledge base', async () => {
    const service = createService();
    const deleteWithFilesSpy = vi.fn().mockResolvedValue({
      deletedFiles: [],
    });

    Reflect.set(service, 'knowledgeBaseModel', {
      deleteWithFiles: deleteWithFilesSpy,
    });

    await expect(service.deleteKnowledgeBase('kb-1')).resolves.toEqual({
      message: 'Knowledge base deleted successfully',
      success: true,
    });

    expect(deleteWithFilesSpy).toHaveBeenCalledWith('kb-1');
  });

  it('should delete external files when deleted knowledge-base files have URLs', async () => {
    const service = createService();

    Reflect.set(service, 'knowledgeBaseModel', {
      deleteWithFiles: vi.fn().mockResolvedValue({
        deletedFiles: [
          { id: 'file-1', url: 'https://example.com/a.pdf' },
          { id: 'file-2', url: null },
          { id: 'file-3', url: 'https://example.com/b.pdf' },
        ],
      }),
    });

    await service.deleteKnowledgeBase('kb-1');

    expect(deleteFilesSpy).toHaveBeenCalledWith([
      'https://example.com/a.pdf',
      'https://example.com/b.pdf',
    ]);
  });

  it('should skip external file deletion when deleted files have no URLs', async () => {
    const service = createService();

    Reflect.set(service, 'knowledgeBaseModel', {
      deleteWithFiles: vi.fn().mockResolvedValue({
        deletedFiles: [{ id: 'file-1', url: null }],
      }),
    });

    await service.deleteKnowledgeBase('kb-1');

    expect(deleteFilesSpy).not.toHaveBeenCalled();
  });
});
