import { LayersEnum } from '@lobechat/types';
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
    runWithDocumentLock: vi.fn(function <T>(_id: string, fn: (lockOwnerId?: string) => Promise<T>) {
      return fn('server:lock-owner');
    }),
    updateDocument: vi.fn<(id: string, params: Record<string, unknown>) => Promise<unknown>>(),
  },
  memoryModels: {
    activityDelete: vi.fn<(id: string) => Promise<{ success: boolean }>>(),
    preferenceDelete: vi.fn<(id: string) => Promise<{ success: boolean }>>(),
    preferenceUserIds: [] as string[],
  },
  receiptService: {
    getAgentSignalReceipt:
      vi.fn<(receiptId: string) => Promise<Record<string, unknown> | undefined>>(),
    updateAgentSignalReceiptMetadata:
      vi.fn<(receiptId: string, metadata: Record<string, unknown>) => Promise<unknown>>(),
  },
}));

vi.mock('@/server/services/document', () => ({
  DocumentService: vi.fn(function () {
    return mocks.documentService;
  }),
}));

vi.mock('@/database/models/userMemory', () => ({
  UserMemoryActivityModel: vi.fn(function () {
    return { delete: mocks.memoryModels.activityDelete };
  }),
  UserMemoryContextModel: vi.fn(),
  UserMemoryExperienceModel: vi.fn(),
  UserMemoryIdentityModel: vi.fn(),
  UserMemoryPreferenceModel: vi.fn(function (_db: unknown, userId: string) {
    mocks.memoryModels.preferenceUserIds.push(userId);
    return { delete: mocks.memoryModels.preferenceDelete };
  }),
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
    mocks.documentService.runWithDocumentLock.mockImplementation(function <T>(
      _id: string,
      fn: (lockOwnerId?: string) => Promise<T>,
    ) {
      return fn('server:lock-owner');
    });
    mocks.memoryModels.preferenceUserIds.length = 0;
    mocks.receiptService.getAgentSignalReceipt.mockResolvedValue({
      id: 'receipt-1',
      kind: 'skill',
      userId: 'user-1',
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
      writeSource: 'system',
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

  describe('memory receipts', () => {
    const memoryReceipt = (overrides: Record<string, unknown> = {}) => ({
      id: 'receipt-memory-1',
      kind: 'memory',
      metadata: { rollbackStatus: 'available', sourceType: 'agent.execution.completed' },
      target: {
        id: 'preference-1',
        memoryId: 'memory-1',
        memoryLayer: LayersEnum.Preference,
        operation: 'create',
        summary: 'Prefers decision-first reviews',
        title: 'Decision-first review preference',
        type: 'memory',
      },
      userId: 'user-1',
      ...overrides,
    });
    const memoryInput = { receiptId: 'receipt-memory-1' };

    /**
     * @example
     * Undo on a created memory deletes it through the caller-scoped layer model and marks the receipt.
     */
    it('deletes the created memory and marks the receipt rolled back', async () => {
      mocks.receiptService.getAgentSignalReceipt.mockResolvedValue(memoryReceipt());
      mocks.memoryModels.preferenceDelete.mockResolvedValue({ success: true });

      const result = await rollbackAgentSignalReceipt(memoryInput, { db, userId: 'user-1' });

      expect(result).toEqual({ receiptId: 'receipt-memory-1', status: 'rolled_back' });
      expect(mocks.memoryModels.preferenceUserIds).toEqual(['user-1']);
      expect(mocks.memoryModels.preferenceDelete).toHaveBeenCalledWith('preference-1');
      expect(mocks.receiptService.updateAgentSignalReceiptMetadata).toHaveBeenCalledWith(
        'receipt-memory-1',
        expect.objectContaining({ rollbackStatus: 'rolled_back' }),
      );
      expect(mocks.documentService.runWithDocumentLock).not.toHaveBeenCalled();
    });

    /**
     * @example
     * Activity memories route to their own layer model.
     */
    it('deletes through the layer model that owns the memory', async () => {
      mocks.receiptService.getAgentSignalReceipt.mockResolvedValue(
        memoryReceipt({
          target: {
            id: 'activity-1',
            memoryLayer: LayersEnum.Activity,
            operation: 'create',
            title: 'Gym session',
            type: 'memory',
          },
        }),
      );
      mocks.memoryModels.activityDelete.mockResolvedValue({ success: true });

      const result = await rollbackAgentSignalReceipt(memoryInput, { db, userId: 'user-1' });

      expect(result.status).toBe('rolled_back');
      expect(mocks.memoryModels.activityDelete).toHaveBeenCalledWith('activity-1');
      expect(mocks.memoryModels.preferenceDelete).not.toHaveBeenCalled();
    });

    /**
     * @example
     * Another user's receipt id reads as missing and nothing is deleted.
     */
    it('refuses to undo a receipt owned by another user', async () => {
      mocks.receiptService.getAgentSignalReceipt.mockResolvedValue(
        memoryReceipt({ userId: 'user-2' }),
      );

      const result = await rollbackAgentSignalReceipt(memoryInput, { db, userId: 'user-1' });

      expect(result).toEqual({
        reason: 'Receipt not found',
        receiptId: 'receipt-memory-1',
        status: 'not_found',
      });
      expect(mocks.memoryModels.preferenceDelete).not.toHaveBeenCalled();
      expect(mocks.receiptService.updateAgentSignalReceiptMetadata).not.toHaveBeenCalled();
    });

    /**
     * @example
     * Repeating undo after success is a no-op that reports the settled state.
     */
    it('is idempotent once the receipt is rolled back', async () => {
      mocks.receiptService.getAgentSignalReceipt.mockResolvedValue(
        memoryReceipt({ metadata: { rollbackStatus: 'rolled_back' } }),
      );

      const result = await rollbackAgentSignalReceipt(memoryInput, { db, userId: 'user-1' });

      expect(result).toEqual({ receiptId: 'receipt-memory-1', status: 'already_rolled_back' });
      expect(mocks.memoryModels.preferenceDelete).not.toHaveBeenCalled();
      expect(mocks.receiptService.updateAgentSignalReceiptMetadata).not.toHaveBeenCalled();
    });

    /**
     * @example
     * A concurrent duplicate undo that finds the memory gone does not overwrite the winner's status.
     */
    it('reports already_rolled_back when a concurrent undo deleted the memory first', async () => {
      mocks.receiptService.getAgentSignalReceipt
        .mockResolvedValueOnce(memoryReceipt())
        .mockResolvedValueOnce(memoryReceipt({ metadata: { rollbackStatus: 'rolled_back' } }));
      mocks.memoryModels.preferenceDelete.mockResolvedValue({ success: false });

      const result = await rollbackAgentSignalReceipt(memoryInput, { db, userId: 'user-1' });

      expect(result.status).toBe('already_rolled_back');
      expect(mocks.receiptService.updateAgentSignalReceiptMetadata).not.toHaveBeenCalled();
    });

    /**
     * @example
     * A memory the user already deleted elsewhere cannot be undone and the receipt stops offering it.
     */
    it('returns not_found when the memory no longer exists', async () => {
      mocks.receiptService.getAgentSignalReceipt.mockResolvedValue(memoryReceipt());
      mocks.memoryModels.preferenceDelete.mockResolvedValue({ success: false });

      const result = await rollbackAgentSignalReceipt(memoryInput, { db, userId: 'user-1' });

      expect(result).toEqual({
        reason: 'Memory no longer exists',
        receiptId: 'receipt-memory-1',
        status: 'not_found',
      });
      expect(mocks.receiptService.updateAgentSignalReceiptMetadata).toHaveBeenCalledWith(
        'receipt-memory-1',
        expect.objectContaining({ rollbackStatus: 'not_found' }),
      );
    });

    /**
     * @example
     * Updates to an existing memory carry no prior snapshot, so they are not undoable.
     */
    it('does not undo memory updates', async () => {
      mocks.receiptService.getAgentSignalReceipt.mockResolvedValue(
        memoryReceipt({
          metadata: { sourceType: 'agent.execution.completed' },
          target: {
            id: 'identity-1',
            memoryLayer: LayersEnum.Identity,
            operation: 'update',
            title: 'Senior engineer',
            type: 'memory',
          },
        }),
      );

      const result = await rollbackAgentSignalReceipt(memoryInput, { db, userId: 'user-1' });

      expect(result.status).toBe('unsupported');
      expect(mocks.memoryModels.preferenceDelete).not.toHaveBeenCalled();
    });

    /**
     * @example
     * A delete failure surfaces the reason so the client can show it.
     */
    it('returns failed with the error reason when deletion throws', async () => {
      mocks.receiptService.getAgentSignalReceipt.mockResolvedValue(memoryReceipt());
      mocks.memoryModels.preferenceDelete.mockRejectedValue(new Error('database unavailable'));
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await rollbackAgentSignalReceipt(memoryInput, { db, userId: 'user-1' });

      expect(result).toEqual({
        reason: 'database unavailable',
        receiptId: 'receipt-memory-1',
        status: 'failed',
      });
    });
  });
});
