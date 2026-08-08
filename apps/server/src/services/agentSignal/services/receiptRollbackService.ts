import { TRPCError } from '@trpc/server';

import type { LobeChatDatabase } from '@/database/type';
import {
  getAgentSignalReceipt,
  updateAgentSignalReceiptMetadata,
} from '@/server/services/agentSignal/services/receiptService';
import { DocumentService } from '@/server/services/document';

type RollbackTerminalStatus = 'conflict' | 'failed' | 'not_found' | 'rolled_back';

/**
 * Input required to rollback one skill-refine receipt.
 */
export interface RollbackAgentSignalReceiptInput {
  /** Optional managed-skill binding id kept for receipt/UI bookkeeping. */
  agentDocumentId?: string;
  /** Backing document id that should be restored. */
  documentId: string;
  /** Pre-mutation history id captured before the refine write. */
  historyId: string;
  /** Receipt whose metadata should be updated with the terminal rollback status. */
  receiptId: string;
}

/**
 * Runtime context for Agent Signal receipt rollback.
 */
export interface AgentSignalReceiptRollbackContext {
  /** Database handle used by the document service. */
  db: LobeChatDatabase;
  /** Owner user id for scoped document access. */
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
  /** Backing document id that was requested. */
  documentId: string;
  /** Requested history id. */
  historyId: string;
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
  documentId: input.documentId,
  historyId: input.historyId,
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
  status: RollbackTerminalStatus,
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
 * Restores a skill-refine receipt from the existing document history timeline.
 *
 * Use when:
 * - A self-iteration receipt exposes `documentId` + `historyId` for undo.
 *
 * Expects:
 * - The target history row belongs to the same backing document.
 *
 * Returns:
 * - One stable terminal rollback status for the receipt UI.
 */
export const rollbackAgentSignalReceipt = async (
  input: RollbackAgentSignalReceiptInput,
  context: AgentSignalReceiptRollbackContext,
): Promise<AgentSignalReceiptRollbackResult> => {
  const documentService = new DocumentService(context.db, context.userId, context.workspaceId);
  const receipt = await getAgentSignalReceipt(input.receiptId);

  if (!receipt) {
    return toResult(input, 'not_found', 'Receipt not found');
  }

  const expectedCurrentDocumentUpdatedAt = receipt.metadata?.expectedCurrentDocumentUpdatedAt;
  const resolvedInput: RollbackAgentSignalReceiptInput = {
    ...input,
    ...(receipt.metadata?.agentDocumentId
      ? { agentDocumentId: receipt.metadata.agentDocumentId }
      : {}),
    ...(receipt.metadata?.documentId ? { documentId: receipt.metadata.documentId } : {}),
    ...(receipt.metadata?.historyId ? { historyId: receipt.metadata.historyId } : {}),
  };

  if (!expectedCurrentDocumentUpdatedAt) {
    await persistRollbackStatus(resolvedInput, 'conflict');
    return toResult(resolvedInput, 'conflict', 'Receipt is missing the current document marker');
  }

  try {
    return await documentService.runWithDocumentLock(
      resolvedInput.documentId,
      async (lockOwnerId) => {
        const current = await documentService.getDocumentById(resolvedInput.documentId);
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
            return await documentService.getDocumentHistoryItem({
              documentId: resolvedInput.documentId,
              historyId: resolvedInput.historyId,
            });
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

        await documentService.updateDocument(resolvedInput.documentId, {
          editorData: history.editorData,
          ...(lockOwnerId ? { lockOwnerId } : {}),
          restoreFromHistoryId: history.id,
          saveSource: 'restore',
        });

        await persistRollbackStatus(resolvedInput, 'rolled_back');
        return toResult(resolvedInput, 'rolled_back');
      },
    );
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
