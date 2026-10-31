import { type LobeChatDatabase } from '@lobechat/database';
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';

import { DocumentHistoryService } from '../history';
import { DocumentService } from '../index';

const { checkDocumentCharLimit } = vi.hoisted(() => ({ checkDocumentCharLimit: vi.fn() }));

vi.mock('@/business/server/document/writeLimit', () => ({ checkDocumentCharLimit }));
vi.mock('@/server/modules/AgentRuntime/redis', () => ({ getAgentRuntimeRedisClient: () => null }));
vi.mock('@/server/services/resourceEvents', () => ({ publishResourceEvent: vi.fn() }));
vi.mock('@/database/models/document');
vi.mock('@/database/models/file');
vi.mock('@/database/models/knowledgeBase');
vi.mock('../../file');
vi.mock('../history');

const refuse = () => checkDocumentCharLimit.mockResolvedValue({ allowed: false, limit: 10 });

describe('DocumentService per-document character limit', () => {
  const documentModel = {
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  };
  const db = {
    transaction: async (fn: (tx: unknown) => unknown) => fn({}),
  } as unknown as LobeChatDatabase;
  const service = () => new DocumentService(db, 'user-1', 'ws-1');

  beforeEach(() => {
    vi.clearAllMocks();
    checkDocumentCharLimit.mockResolvedValue({ allowed: true });
    documentModel.create.mockResolvedValue({ id: 'doc-1' });
    documentModel.findById.mockResolvedValue({
      content: '12345678901234',
      fileType: 'custom/document',
      id: 'doc-1',
      updatedAt: new Date(),
    });
    documentModel.update.mockResolvedValue(new Date());
    vi.mocked(DocumentModel).mockImplementation(function () {
      return documentModel as any;
    });
    vi.mocked(DocumentHistoryService).mockImplementation(function () {
      return { createHistory: vi.fn() } as any;
    });
    vi.mocked(FileModel).mockImplementation(function () {
      return {} as any;
    });
    vi.mocked(KnowledgeBaseModel).mockImplementation(function () {
      return {} as any;
    });
  });

  describe('createDocument', () => {
    it('refuses over-limit content before inserting a row', async () => {
      refuse();

      await expect(
        service().createDocument({ content: 'x'.repeat(11), title: 'T' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      expect(checkDocumentCharLimit).toHaveBeenCalledWith(
        expect.objectContaining({ charCount: 11, userId: 'user-1', workspaceId: 'ws-1' }),
      );
      expect(documentModel.create).not.toHaveBeenCalled();
    });

    it('skips the check for a system write', async () => {
      refuse();

      await service().createDocument({
        content: 'x'.repeat(11),
        title: 'T',
        writeSource: 'system',
      });

      expect(checkDocumentCharLimit).not.toHaveBeenCalled();
      expect(documentModel.create).toHaveBeenCalled();
    });

    it('passes the agent source to the limit check', async () => {
      await service().createDocument({ content: 'abc', title: 'T', writeSource: 'agent' });

      expect(checkDocumentCharLimit).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'agent' }),
      );
    });

    it('does not check a document without content', async () => {
      refuse();

      await service().createDocument({ editorData: {}, title: 'T' });

      expect(documentModel.create).toHaveBeenCalled();
    });
  });

  describe('updateDocument', () => {
    it('refuses a write that makes the document longer than the limit', async () => {
      refuse();

      await expect(
        service().updateDocument('doc-1', { content: 'x'.repeat(20) }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      expect(documentModel.update).not.toHaveBeenCalled();
    });

    it('allows a write that shrinks an already over-limit document', async () => {
      refuse();

      await service().updateDocument('doc-1', { content: 'x'.repeat(12) });

      expect(documentModel.update).toHaveBeenCalled();
    });

    it('exempts a system write', async () => {
      refuse();

      await service().updateDocument('doc-1', { content: 'x'.repeat(20), writeSource: 'system' });

      expect(documentModel.update).toHaveBeenCalled();
    });

    it('skips room projections', async () => {
      refuse();

      await service().updateDocument('doc-1', {
        content: 'x'.repeat(20),
        origin: 'room-projection',
      });

      expect(checkDocumentCharLimit).not.toHaveBeenCalled();
      expect(documentModel.update).toHaveBeenCalled();
    });

    it('checks a client restore: its history id is not proof of the body', async () => {
      refuse();

      await expect(
        service().updateDocument('doc-1', {
          content: 'x'.repeat(20),
          restoreFromHistoryId: 'h1',
        }),
      ).rejects.toThrow(TRPCError);
      expect(documentModel.update).not.toHaveBeenCalled();
    });

    it('does not check an editorData-only update', async () => {
      refuse();

      await service().updateDocument('doc-1', { editorData: { root: {} } });

      expect(checkDocumentCharLimit).not.toHaveBeenCalled();
    });
  });
});
