/**
 * Locating the run's own assistant message row in the database.
 */
import debug from 'debug';

import { MessageModel } from '@/database/models/message';

import { extractTextFromMessage } from './messageContent';
import type { CompletionLifecycleDeps } from './types';

const log = debug('lobe-server:completion-lifecycle');

/**
 * Load the final assistant message row from the DB and return its text
 * content, for completions whose Redis-side state carried no assistant
 * text (see the DB recovery note in {@link dispatchHooks}). Non-fatal: any
 * failure just leaves the event as-built.
 */
export async function recoverLastAssistantContent(
  deps: CompletionLifecycleDeps,
  operationId: string,
  assistantMessageId: string | undefined,
  userId: string,
  topicId?: string,
): Promise<string | undefined> {
  if (!assistantMessageId && !topicId) return undefined;

  try {
    const messageModel =
      userId === deps.userId
        ? deps.messageModel
        : new MessageModel(deps.serverDB, userId, deps.workspaceId, undefined, {
            includeShareVisitor: deps.includeShareVisitor,
          });

    // 1. The row the event already names (client-runtime `metadata.assistantMessageId`,
    //    or the final assistant leaf in state).
    let row = assistantMessageId ? await messageModel.findById(assistantMessageId) : undefined;
    let recoveredFrom = assistantMessageId;

    // 2. Otherwise the run's own final assistant row, by the creation-time
    //    provenance `call_llm` stamps on every assistant row it creates or
    //    reuses (`metadata.operationId`). Unlike "the latest assistant row in
    //    the topic", this is bound to THIS operation, so a topic that also
    //    holds a concurrent run's rows cannot supply the answer (root cause of
    //    the Discord thread bug where the bot kept repeating the same reply).
    if (!extractTextFromMessage(row)?.trim() && topicId) {
      const byOperation = await messageModel.findLatestAssistantByOperationId({
        operationId,
        topicId,
      });
      if (byOperation) {
        row = byOperation;
        recoveredFrom = byOperation.id;
      }
    }

    const raw = typeof row?.content === 'string' ? row.content : undefined;
    if (!raw?.trim()) return undefined;

    // Multimodal rows store `content` as serialized MessageContentPart[]
    // (see callLlmFinalizer / serializePartsForStorage) — sending
    // that verbatim would deliver raw JSON to the bot channel. Gate on the
    // row's `metadata.isMultimodal` flag (the same signal the app UI uses
    // in DisplayContent) rather than sniffing the string, so a legitimate
    // plain-text reply that happens to be a JSON array is preserved as-is.
    // Extract only the text parts; an image-only row recovers nothing.
    const content = extractTextFromMessage(row);
    if (!content?.trim()) return undefined;

    // console (not debug) so state/DB divergence stays visible in
    // production logs — the silent variant of this is what made
    // the Discord bot empty-reply issue hard to diagnose.
    console.warn(
      `[CompletionLifecycle][${operationId}] completion event had no assistant text; recovered ${content.length} chars from message ${recoveredFrom}`,
    );
    return content;
  } catch (error) {
    log('[%s] recoverLastAssistantContent failed (non-fatal): %O', operationId, error);
    return undefined;
  }
}

/**
 * The assistant row an error belongs on. The client runtime names it in
 * `metadata.assistantMessageId`; a server `execAgent` turn leaves that unset,
 * so fall back to the run's own newest assistant row (`call_llm` stamps
 * `metadata.operationId` on it). Without this, a server run that fails with
 * no client online — a closed tab, a bot, a schedule — leaves an empty
 * bubble with no error card. Never the topic's latest row: that may belong
 * to an earlier turn or a concurrent run.
 */
export async function resolveErrorMessageId(
  deps: CompletionLifecycleDeps,
  operationId: string,
  metadata: { assistantMessageId?: string } | undefined,
  runOrigin: { topicId?: string; userId?: string },
): Promise<string | undefined> {
  if (metadata?.assistantMessageId) return metadata.assistantMessageId;
  if (!runOrigin.topicId || (runOrigin.userId && runOrigin.userId !== deps.userId)) return;

  try {
    const row = await deps.messageModel.findLatestAssistantByOperationId({
      operationId,
      topicId: runOrigin.topicId,
    });
    return row?.id;
  } catch (error) {
    log('[%s] Failed to resolve the run assistant row for its error: %O', operationId, error);
    return undefined;
  }
}
