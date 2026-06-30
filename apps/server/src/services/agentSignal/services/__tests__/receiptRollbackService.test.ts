import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { rollbackAgentSignalReceipt } from '../receiptRollbackService';

const mocks = vi.hoisted(() => ({
  documentService: {
    getDocumentById: vi.fn<(id: string) => Promise<unknown>>(),
    getDocumentHistoryItem: vi.fn<
      (params: { documentId: string; historyId: string }) => Promise<
        | {
            editorData: Record<string, unknown> | null;
            id: string;
          }
        | undefined
      >
    >(),
    runWithDocumentLock: vi.fn(<T>(_id: string, fn: (lockOwnerId?: string) => Promise<T>) =>
      fn('server:lock-owner'),
    ),
    updateDocument: vi.fn<(id: string, params: Record<string, unknown>) => Promise<unknown>>(),
  },
  receiptService: {
    getAgentSignalReceipt:
      vi.fn<(receiptId: string) => Promise<Record<string, unknown> | undefined>>(),
    updateAgentSignalReceiptMetadata:
      vi.fn<(receiptId: string, metadata: Record<string, unknown>) => Promise<unknown>>(),
  },
}));

vi.mock('@/server/services/document', () => ({
  DocumentService: vi.fn(() => mocks.documentService),
}));

vi.mock('@/server/services/agentSignal/services/receiptService', () => ({
  getAgentSignalReceipt: mocks.receiptService.getAgentSignalReceipt,
  updateAgentSignalReceiptMetadata: mocks.receiptService.updateAgentSignalReceiptMetadata,
}));

const db = {} as LobeChatDatabase;
const baseInput = {
  agentDocumentId: 'adoc-1',
  documentId: 'doc-1',
  historyId: 'history-1',
  receiptId: 'receipt-1',
};

describe('rollbackAgentSignalReceipt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.documentService.runWithDocumentLock.mockImplementation(
      <T>(_id: string, fn: (lockOwnerId?: string) => Promise<T>) => fn('server:lock-owner'),
    );
    mocks.receiptService.getAgentSignalReceipt.mockResolvedValue({
      id: 'receipt-1',
      metadata: {
        documentId: 'doc-1',
        expectedCurrentDocumentUpdatedAt: '2026-06-29T00:00:00.000Z',
        historyId: 'history-1',
        rollbackStatus: 'available',
      },
    });
  });

  /**
   * @example
   * A missing current document returns not_found without trying to update anything.
   */
  it('returns not_found when the target document is missing', async () => {
    mocks.documentService.getDocumentById.mockResolvedValue(undefined);

    const result = await rollbackAgentSignalReceipt(baseInput, { db, userId: 'user-1' });

    expect(result).toEqual({
      agentDocumentId: 'adoc-1',
      documentId: 'doc-1',
      historyId: 'history-1',
      receiptId: 'receipt-1',
      status: 'not_found',
    });
    expect(mocks.documentService.updateDocument).not.toHaveBeenCalled();
    expect(mocks.receiptService.updateAgentSignalReceiptMetadata).toHaveBeenCalledWith(
      'receipt-1',
      expect.objectContaining({ rollbackStatus: 'not_found' }),
    );
  });

  /**
   * @example
   * A valid history restore writes the prior editor snapshot back to the document.
   */
  it('restores the document from the captured history item', async () => {
    const editorData = { root: { children: [], type: 'root' } };
    mocks.documentService.getDocumentById.mockResolvedValue({
      id: 'doc-1',
      updatedAt: new Date('2026-06-29T00:00:00.000Z'),
    });
    mocks.documentService.getDocumentHistoryItem.mockResolvedValue({
      editorData,
      id: 'history-1',
    });

    const result = await rollbackAgentSignalReceipt(baseInput, {
      db,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    expect(result.status).toBe('rolled_back');
    expect(mocks.documentService.runWithDocumentLock).toHaveBeenCalledWith(
      'doc-1',
      expect.any(Function),
    );
    expect(mocks.documentService.getDocumentHistoryItem).toHaveBeenCalledWith({
      documentId: 'doc-1',
      historyId: 'history-1',
    });
    expect(mocks.documentService.updateDocument).toHaveBeenCalledWith('doc-1', {
      editorData,
      lockOwnerId: 'server:lock-owner',
      restoreFromHistoryId: 'history-1',
      saveSource: 'restore',
    });
    expect(mocks.receiptService.updateAgentSignalReceiptMetadata).toHaveBeenCalledWith(
      'receipt-1',
      expect.objectContaining({ rollbackStatus: 'rolled_back' }),
    );
  });

  /**
   * @example
   * A collaborative lock conflict returns conflict so the receipt can stop offering undo.
   */
  it('returns conflict when the document lock rejects the restore', async () => {
    mocks.documentService.runWithDocumentLock.mockRejectedValue(
      new TRPCError({ code: 'CONFLICT', message: 'Document is being edited by another user' }),
    );

    const result = await rollbackAgentSignalReceipt(baseInput, {
      db,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    expect(result).toEqual({
      agentDocumentId: 'adoc-1',
      documentId: 'doc-1',
      historyId: 'history-1',
      receiptId: 'receipt-1',
      reason: 'Document is being edited by another user',
      status: 'conflict',
    });
  });

  /**
   * @example
   * A stale receipt whose expected document marker no longer matches returns conflict and does not overwrite later edits.
   */
  it('returns conflict when the document changed after the receipt was created', async () => {
    mocks.documentService.getDocumentById.mockResolvedValue({
      id: 'doc-1',
      updatedAt: new Date('2026-06-29T01:00:00.000Z'),
    });

    const result = await rollbackAgentSignalReceipt(baseInput, {
      db,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    expect(result).toEqual({
      agentDocumentId: 'adoc-1',
      documentId: 'doc-1',
      historyId: 'history-1',
      receiptId: 'receipt-1',
      reason: 'Document changed since this receipt was created',
      status: 'conflict',
    });
    expect(mocks.documentService.updateDocument).not.toHaveBeenCalled();
    expect(mocks.receiptService.updateAgentSignalReceiptMetadata).toHaveBeenCalledWith(
      'receipt-1',
      expect.objectContaining({ rollbackStatus: 'conflict' }),
    );
  });
});
