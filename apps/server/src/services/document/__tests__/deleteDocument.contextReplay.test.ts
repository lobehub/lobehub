import { type LobeChatDatabase } from '@lobechat/database';
import { beforeEach, expect, it, vi } from 'vitest';

import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';

import { scrubDeletedContextSources } from '../../contextReplay/scrub';
import { DocumentService } from '../index';

vi.mock('@/server/modules/AgentRuntime/redis', () => ({ getAgentRuntimeRedisClient: () => null }));
vi.mock('@/database/models/document');
vi.mock('@/database/models/file');
vi.mock('@/database/models/knowledgeBase');
vi.mock('../../file');
vi.mock('../history');
vi.mock('../../pageCollab/notify', () => ({ dropPageRooms: vi.fn() }));
vi.mock('../../contextReplay/scrub', () => ({ scrubDeletedContextSources: vi.fn() }));

const documentModel = { delete: vi.fn(), findById: vi.fn() };

beforeEach(() => {
  vi.mocked(scrubDeletedContextSources).mockClear();
  vi.mocked(DocumentModel).mockImplementation(function () {
    return documentModel as any;
  });
  vi.mocked(FileModel).mockImplementation(function () {
    return {} as any;
  });
  vi.mocked(KnowledgeBaseModel).mockImplementation(function () {
    return {} as any;
  });
  documentModel.findById.mockImplementation(async (id: string) =>
    id === 'folder-1'
      ? { fileId: null, fileType: 'custom/folder', id, workspaceId: null }
      : { fileId: null, fileType: 'custom/document', id, workspaceId: null },
  );
});

it('clears every document removed with a folder from stored model input', async () => {
  const db = {
    query: {
      documents: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: 'child-1' }])
          .mockResolvedValue([]),
      },
      files: { findMany: vi.fn().mockResolvedValue([]) },
    },
  };

  await new DocumentService(db as unknown as LobeChatDatabase, 'user-1').deleteDocument('folder-1');

  const ids = vi
    .mocked(scrubDeletedContextSources)
    .mock.calls.flatMap(([, sources]) => sources.ids);
  expect(ids).toEqual(expect.arrayContaining(['document:folder-1', 'document:child-1']));
});
