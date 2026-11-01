import { LayersEnum } from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import {
  UserMemoryActivityModel,
  UserMemoryContextModel,
  UserMemoryExperienceModel,
  UserMemoryIdentityModel,
  UserMemoryPreferenceModel,
} from '@/database/models/userMemory';
import type { LobeChatDatabase } from '@/database/type';
import {
  type AgentSignalReceipt,
  getAgentSignalReceipt,
  updateAgentSignalReceiptMetadata,
} from '@/server/services/agentSignal/services/receiptService';
import { DocumentService } from '@/server/services/document';
import { updateDocumentThroughRoom } from '@/server/services/pageCollab/bodyWriter';

type RollbackPersistedStatus = 'conflict' | 'failed' | 'not_found' | 'rolled_back' | 'unsupported';
type RollbackTerminalStatus = RollbackPersistedStatus | 'already_rolled_back';

/**
 * Input required to rollback one Agent Signal receipt.
 *
 * Skill receipts restore a document history snapshot; memory receipts delete the memory the run
 * created. Rollback targets are always re-read from the persisted receipt, so the optional ids
 * here are only echoed back for the client's bookkeeping.
 */
export interface RollbackAgentSignalReceiptInput {
  /** Optional managed-skill binding id kept for receipt/UI bookkeeping. */
  agentDocumentId?: string;
  /** Backing document id that should be restored (skill receipts). */
  documentId?: string;
  /** Pre-mutation history id captured before the refine write (skill receipts). */
  historyId?: string;
  /** Receipt whose metadata should be updated with the terminal rollback status. */
  receiptId: string;
}

/**
 * Runtime context for Agent Signal receipt rollback.
 */
export interface AgentSignalReceiptRollbackContext {
  /** Database handle used by the document / memory models. */
  db: LobeChatDatabase;
  /** Owner user id; the receipt and its target must belong to this user. */
  userId: string;
  /** Optional workspace scope for collaborative documents. */
  workspaceId?: string;
}

/**
 * Stable rollback result returned to the router and UI.
 */
export interface AgentSignalReceiptRollbackResult {
  /** Optional managed-skill binding id echoed back to the client. */
  agentDocumentId?: string;
  /** Backing document id that was requested (skill receipts). */
  documentId?: string;
  /** Requested history id (skill receipts). */
  historyId?: string;
  /** Human-readable reason for non-success terminal states. */
  reason?: string;
  /** Requested receipt id. */
  receiptId: string;
  /** Terminal rollback result status. */
  status: RollbackTerminalStatus;
}

const toResult = (
  input: RollbackAgentSignalReceiptInput,
  status: RollbackTerminalStatus,
  reason?: string,
): AgentSignalReceiptRollbackResult => ({
  ...(input.agentDocumentId ? { agentDocumentId: input.agentDocumentId } : {}),
  ...(input.documentId ? { documentId: input.documentId } : {}),
  ...(input.historyId ? { historyId: input.historyId } : {}),
  receiptId: input.receiptId,
  ...(reason ? { reason } : {}),
  status,
});

const toIsoString = (value: Date | string | undefined) => {
  if (!value) return undefined;

  return value instanceof Date ? value.toISOString() : value;
};

const persistRollbackStatus = async (
  input: RollbackAgentSignalReceiptInput,
  status: RollbackPersistedStatus,
) => {
  try {
    const receipt = await getAgentSignalReceipt(input.receiptId);
    if (!receipt) return;

    await updateAgentSignalReceiptMetadata(input.receiptId, {
      ...receipt.metadata,
      rollbackStatus: status,
    });
  } catch (error) {
    console.error('[AgentSignal] Failed to persist rollback receipt status:', {
      error,
      receiptId: input.receiptId,
      status,
    });
  }
};

/**
 * Deletes one layer-specific memory row (and its base memory) owned by the user.
 *
 * Returns `false` when the row no longer exists for this user.
 */
const deleteMemoryByLayer = async (
  db: LobeChatDatabase,
  userId: string,
  layer: LayersEnum,
  id: string,
): Promise<boolean> => {
  switch (layer) {
    case LayersEnum.Activity: {
      return (await new UserMemoryActivityModel(db, userId).delete(id)).success;
    }
    case LayersEnum.Context: {
      return (await new UserMemoryContextModel(db, userId).delete(id)).success;
    }
    case LayersEnum.Experience: {
      return (await new UserMemoryExperienceModel(db, userId).delete(id)).success;
    }
    case LayersEnum.Identity: {
      return (await new UserMemoryIdentityModel(db, userId).delete(id)).success;
    }
    case LayersEnum.Preference: {
      return (await new UserMemoryPreferenceModel(db, userId).delete(id)).success;
    }
    default: {
      return false;
    }
  }
};

/**
 * Undoes a memory receipt by deleting the memory the self-iteration run created.
 *
 * Only `create` writes are undoable: update / remove writes carry no prior snapshot, so they
 * resolve to `unsupported`. A concurrent duplicate undo that loses the race reports
 * `already_rolled_back` instead of overwriting the winner's status.
 */
const rollbackMemoryReceipt = async (
  receipt: AgentSignalReceipt,
  input: RollbackAgentSignalReceiptInput,
  context: AgentSignalReceiptRollbackContext,
): Promise<AgentSignalReceiptRollbackResult> => {
  const target = receipt.target;

  if (
    receipt.metadata?.rollbackStatus !== 'available' ||
    target?.type !== 'memory' ||
    target.operation !== 'create' ||
    !target.id ||
    !target.memoryLayer
  ) {
    return toResult(input, 'unsupported', 'This memory change cannot be undone');
  }

  try {
    const deleted = await deleteMemoryByLayer(
      context.db,
      context.userId,
      target.memoryLayer,
      target.id,
    );

    if (!deleted) {
      const latest = await getAgentSignalReceipt(input.receiptId);
      if (latest?.metadata?.rollbackStatus === 'rolled_back') {
        return toResult(input, 'already_rolled_back');
      }

      await persistRollbackStatus(input, 'not_found');
      return toResult(input, 'not_found', 'Memory no longer exists');
    }

    await persistRollbackStatus(input, 'rolled_back');
    return toResult(input, 'rolled_back');
  } catch (error) {
    console.error('[AgentSignal] Failed to undo memory receipt:', {
      error,
      receiptId: input.receiptId,
    });
    await persistRollbackStatus(input, 'failed');
    return toResult(input, 'failed', error instanceof Error ? error.message : 'Undo failed');
  }
};

/**
 * Undoes one Agent Signal receipt owned by the caller.
 *
 * Use when:
 * - A skill receipt exposes `documentId` + `historyId`: restores the document history snapshot.
 * - A memory receipt records a `create` write: deletes the created memory.
 *
 * Expects:
 * - The receipt belongs to `context.userId`; other users' receipts read as `not_found`.
 * - Repeated calls are safe: a receipt already rolled back returns `already_rolled_back`.
 *
 * Returns:
 * - One stable terminal rollback status for the receipt UI.
 */
export const rollbackAgentSignalReceipt = async (
  input: RollbackAgentSignalReceiptInput,
  context: AgentSignalReceiptRollbackContext,
): Promise<AgentSignalReceiptRollbackResult> => {
  const receipt = await getAgentSignalReceipt(input.receiptId);

  // A receipt owned by someone else reads as missing so ids cannot be probed across users.
  if (!receipt || receipt.userId !== context.userId) {
    return toResult(input, 'not_found', 'Receipt not found');
  }

  if (receipt.metadata?.rollbackStatus === 'rolled_back') {
    return toResult(input, 'already_rolled_back');
  }

  if (receipt.kind === 'memory') {
    return rollbackMemoryReceipt(receipt, input, context);
  }

  const documentService = new DocumentService(context.db, context.userId, context.workspaceId);
  const expectedCurrentDocumentUpdatedAt = receipt.metadata?.expectedCurrentDocumentUpdatedAt;
  const resolvedInput: RollbackAgentSignalReceiptInput = {
    ...input,
    ...(receipt.metadata?.agentDocumentId
      ? { agentDocumentId: receipt.metadata.agentDocumentId }
      : {}),
    ...(receipt.metadata?.documentId ? { documentId: receipt.metadata.documentId } : {}),
    ...(receipt.metadata?.historyId ? { historyId: receipt.metadata.historyId } : {}),
  };

  const { documentId, historyId } = resolvedInput;

  if (!documentId || !historyId) {
    return toResult(resolvedInput, 'unsupported', 'Receipt has no document history to restore');
  }

  if (!expectedCurrentDocumentUpdatedAt) {
    await persistRollbackStatus(resolvedInput, 'conflict');
    return toResult(resolvedInput, 'conflict', 'Receipt is missing the current document marker');
  }

  try {
    return await documentService.runWithDocumentLock(documentId, async (lockOwnerId) => {
      const current = await documentService.getDocumentById(documentId);
      if (!current) {
        await persistRollbackStatus(resolvedInput, 'not_found');
        return toResult(resolvedInput, 'not_found');
      }

      if (toIsoString(current.updatedAt) !== expectedCurrentDocumentUpdatedAt) {
        await persistRollbackStatus(resolvedInput, 'conflict');
        return toResult(
          resolvedInput,
          'conflict',
          'Document changed since this receipt was created',
        );
      }

      const history = await (async () => {
        try {
          return await documentService.getDocumentHistoryItem({ documentId, historyId });
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.startsWith('Document history item not found:')
          ) {
            return undefined;
          }

          throw error;
        }
      })();

      if (!history?.editorData) {
        await persistRollbackStatus(resolvedInput, 'not_found');
        return toResult(resolvedInput, 'not_found', 'Document history not found');
      }

      await updateDocumentThroughRoom(
        context.db,
        documentService,
        documentId,
        {
          editorData: history.editorData,
          ...(lockOwnerId ? { lockOwnerId } : {}),
          restoreFromHistoryId: history.id,
          saveSource: 'restore',
        },
        { userId: context.userId, workspaceId: context.workspaceId },
      );

      await persistRollbackStatus(resolvedInput, 'rolled_back');
      return toResult(resolvedInput, 'rolled_back');
    });
  } catch (error) {
    if (error instanceof TRPCError && error.code === 'CONFLICT') {
      await persistRollbackStatus(resolvedInput, 'conflict');
      return toResult(resolvedInput, 'conflict', error.message);
    }

    await persistRollbackStatus(resolvedInput, 'failed');
    return toResult(
      resolvedInput,
      'failed',
      error instanceof Error ? error.message : 'Rollback failed',
    );
  }
};
