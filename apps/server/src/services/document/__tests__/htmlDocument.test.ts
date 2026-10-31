import { HTML_DOCUMENT_FILE_TYPE } from '@lobechat/const';
import { type LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';

import { EditLockService } from '../../editLock';
import { DocumentHistoryService } from '../history';
import { DocumentService } from '../index';

vi.mock('@/server/modules/AgentRuntime/redis', () => ({ getAgentRuntimeRedisClient: () => null }));
vi.mock('@/database/models/document');
vi.mock('@/database/models/file');
vi.mock('../history');
vi.mock('../../resourceEvents', () => ({ publishResourceEvent: vi.fn() }));

describe('DocumentService.updateDocument on an HTML document', () => {
  const editorData = { root: { children: [{ type: 'paragraph' }], type: 'root' } };
  const html = '<!doctype html><html><body><h1>Report</h1></body></html>';

  let documentModel: { findById: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  let createHistory: ReturnType<typeof vi.fn>;
  let service: DocumentService;

  beforeEach(() => {
    const db = {
      transaction: vi.fn(async (callback: (tx: LobeChatDatabase) => Promise<unknown>) =>
        callback(db),
      ),
    } as unknown as LobeChatDatabase;

    documentModel = {
      findById: vi.fn().mockResolvedValue({
        editorData: null,
        fileId: null,
        fileType: HTML_DOCUMENT_FILE_TYPE,
        id: 'doc-1',
        updatedAt: new Date('2026-10-19T00:00:00.000Z'),
      }),
      update: vi.fn().mockResolvedValue(new Date('2026-10-19T01:00:00.000Z')),
    };
    createHistory = vi.fn();

    vi.mocked(DocumentModel).mockImplementation(function () {
      return documentModel as any;
    });
    vi.mocked(FileModel).mockImplementation(function () {
      return {} as any;
    });
    vi.mocked(DocumentHistoryService).mockImplementation(function () {
      return { createHistory } as any;
    });

    service = new DocumentService(db, 'user-1');
  });

  it('writes the HTML content but never rich-text editorData', async () => {
    const result = await service.updateDocument('doc-1', { content: html, editorData });

    const updates = documentModel.update.mock.calls[0][1];
    expect(updates).toMatchObject({ content: html });
    expect(updates).not.toHaveProperty('editorData');
    expect(createHistory).not.toHaveBeenCalled();
    expect(result.historyAppended).toBe(false);
  });

  it('drops editorData sent in the same write that turns a page into HTML', async () => {
    documentModel.findById.mockResolvedValue({
      editorData,
      fileId: null,
      fileType: 'custom/document',
      id: 'doc-1',
      updatedAt: new Date('2026-10-19T00:00:00.000Z'),
    });

    await service.updateDocument('doc-1', {
      content: html,
      editorData: { root: { children: [], type: 'root' } },
      fileType: HTML_DOCUMENT_FILE_TYPE,
    });

    const updates = documentModel.update.mock.calls[0][1];
    expect(updates).toMatchObject({
      content: html,
      editorData: null,
      fileType: HTML_DOCUMENT_FILE_TYPE,
    });
  });

  it('clears the rich-text editorData a page carried when only its type turns HTML', async () => {
    documentModel.findById.mockResolvedValue({
      editorData,
      fileId: null,
      fileType: 'custom/document',
      id: 'doc-1',
      updatedAt: new Date('2026-10-19T00:00:00.000Z'),
    });

    await service.updateDocument('doc-1', { fileType: HTML_DOCUMENT_FILE_TYPE });

    // Left behind, the pre-HTML JSON would be what the editor loads (and saves)
    // if the page is ever turned back into a rich-text page.
    expect(documentModel.update.mock.calls[0][1]).toEqual({
      editorData: null,
      fileType: HTML_DOCUMENT_FILE_TYPE,
    });
    expect(createHistory).not.toHaveBeenCalled();
  });

  describe('on a shared workspace page another member is editing', () => {
    const sharedPage = (fileType: string, pageEditorData: unknown) => ({
      editorData: pageEditorData,
      fileId: null,
      fileType,
      id: 'doc-1',
      updatedAt: new Date('2026-10-19T00:00:00.000Z'),
      visibility: 'public',
      workspaceId: 'ws-1',
    });

    beforeEach(() => {
      vi.spyOn(EditLockService.prototype, 'canWrite').mockResolvedValue(false);
      service = new DocumentService(
        { transaction: async (callback: any) => callback({}) } as any,
        'user-1',
        'ws-1',
      );
    });

    it.each([
      [
        'turning their rich-text page into HTML',
        sharedPage('custom/document', editorData),
        HTML_DOCUMENT_FILE_TYPE,
      ],
      [
        'turning their HTML page into a rich-text page',
        sharedPage(HTML_DOCUMENT_FILE_TYPE, null),
        'custom/document',
      ],
    ])('refuses %s, which replaces the body they are editing', async (_label, page, fileType) => {
      documentModel.findById.mockResolvedValue(page);

      await expect(service.updateDocument('doc-1', { fileType })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(documentModel.update).not.toHaveBeenCalled();
    });

    it('still lets a metadata-only edit of their HTML page through', async () => {
      documentModel.findById.mockResolvedValue(sharedPage(HTML_DOCUMENT_FILE_TYPE, null));

      await service.updateDocument('doc-1', { title: 'Renamed' });

      expect(documentModel.update).toHaveBeenCalled();
    });
  });
});
