import { TOOL_CANCELLED_CONTENT } from '@/store/chat/agents/transports/ClientToolTransport';
import { type ChatStore } from '@/store/chat/store';

interface RunToolCalls {
  /** Main-agent tool calls whose final result already landed. */
  completedCallIds: ReadonlySet<string>;
  mainCallIds: ReadonlySet<string>;
  messageIdByCallId: ReadonlyMap<string, string>;
}

/**
 * A stop drops every later CLI event, so a tool still running never receives
 * its result and its empty row would render as finished. Persist it as
 * aborted, the same way a cancelled client tool is recorded.
 */
export const markUnfinishedToolsCancelled = async (
  store: Pick<ChatStore, 'optimisticUpdateMessageContent' | 'optimisticUpdateMessagePlugin'>,
  operationId: string,
  { completedCallIds, mainCallIds, messageIdByCallId }: RunToolCalls,
): Promise<void> => {
  const messageIds = [...mainCallIds]
    .filter((callId) => !completedCallIds.has(callId))
    .map((callId) => messageIdByCallId.get(callId))
    .filter((id): id is string => !!id);

  await Promise.all(
    messageIds.map((messageId) =>
      Promise.all([
        store.optimisticUpdateMessageContent(messageId, TOOL_CANCELLED_CONTENT, undefined, {
          operationId,
        }),
        store.optimisticUpdateMessagePlugin(
          messageId,
          { intervention: { status: 'aborted' } },
          { operationId },
        ),
      ]).catch((error) => {
        console.error('[HeterogeneousAgent] Failed to mark cancelled tool:', error);
      }),
    ),
  );
};
