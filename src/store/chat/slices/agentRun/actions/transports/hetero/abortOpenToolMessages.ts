import type { ChatStore } from '@/store/chat/store';

/**
 * Settle the tool rows a stopped run left open. Once the user stops, the
 * executor drops every later stream event — including the terminal result the
 * CLI sends, or the adapter synthesizes, for a tool still running (Copilot's
 * `stopReason: "cancelled"` turn never updates its running tools). Without a
 * result such a row renders as an empty success, so mark it `aborted` instead:
 * the card then shows the cancelled state, now and after a reload.
 */
export const abortOpenToolMessages = async (
  get: () => Pick<ChatStore, 'optimisticUpdateMessagePlugin'>,
  operationId: string,
  toolMessageIds: Iterable<string>,
  settledToolMessageIds: ReadonlySet<string>,
): Promise<string[]> => {
  const open = [...new Set(toolMessageIds)].filter((id) => !settledToolMessageIds.has(id));
  await Promise.all(
    open.map(async (id) => {
      try {
        await get().optimisticUpdateMessagePlugin(
          id,
          { intervention: { status: 'aborted' } },
          { operationId },
        );
      } catch (error) {
        console.error('[HeterogeneousAgent] Failed to mark stopped tool aborted:', error);
      }
    }),
  );
  return open;
};
