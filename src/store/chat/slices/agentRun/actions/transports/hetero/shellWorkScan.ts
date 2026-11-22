/**
 * Commands whose Work card should appear while the run is still going. A CLI
 * agent lays an artboard out with `lh artboard create` and then spends minutes
 * writing its board files; the card is the user's way in to watch them land.
 * The server's scanner does the precise parsing — this is only the trigger.
 */
const LIVE_WORK_COMMAND = /\bartboard\s+(?:create|update)\b/;

/** The server scan's input cap; a longer run keeps its most recent calls. */
const MAX_SCAN_MESSAGES = 500;

const commandOf = (args?: string) => {
  try {
    const command: unknown = JSON.parse(args ?? '')?.command;
    return typeof command === 'string' ? command : undefined;
  } catch {
    return undefined;
  }
};

export interface ShellWorkScanDeps {
  /** Make the anchor and every queued tool write durable; throws when the anchor is missing. */
  persist: (anchorMessageId: string) => Promise<void>;
  refresh: (topicId: string) => Promise<void>;
  register: (params: {
    anchorMessageId: string;
    messageIds: string[];
    topicId: string;
  }) => Promise<{ registered: number }>;
  topicId?: string | null;
}

/**
 * Shell Work scan for a desktop-LOCAL hetero run. Such runs have no server
 * operation, so the server replays its shell scan over the tool messages the
 * executor reports (`work.registerShellWorksForRun`):
 *
 * - live: a call in {@link LIVE_WORK_COMMAND} is scanned the moment its result
 *   lands, anchored to the assistant message that issued it;
 * - completion: every tool message of the run, on clean completion.
 *
 * Both scans share ONE anchor, the message that issued the first live call: a
 * group renders the cards of its latest stamped message, so stamping the final
 * message too would hide the live card. Scans on one anchor derive the same
 * root id server-side and versions dedupe on `(workId, toolCallId)`, so the
 * completion scan re-reading a live-scanned call adds nothing.
 */
export const createShellWorkScan = ({ persist, refresh, register, topicId }: ShellWorkScanDeps) => {
  const liveCalls = new Map<string, string>();
  let anchorId: string | undefined;
  // One live scan at a time, so their refreshes land in order.
  let liveChain: Promise<void> = Promise.resolve();

  const report = (err: unknown) =>
    console.error('[HeterogeneousAgent] Failed to register shell works:', err);

  const scan = async (topic: string, anchorMessageId: string, messageIds: string[]) => {
    const { registered } = await register({ anchorMessageId, messageIds, topicId: topic });
    // Work summaries ride the message payload; re-pull it so the card renders.
    if (registered > 0) await refresh(topic);
  };

  return {
    /**
     * Clean completion: scan every tool message of the run. Never waits on a
     * live scan — the executor already bounded its own write drain, and a live
     * scan stuck behind a write that never settles must not hold the run open.
     */
    complete: async (finalAssistantId: string | undefined, toolMessageIds: string[]) => {
      const anchor = anchorId ?? finalAssistantId;
      // Topicless runs can't scan: the server checks the anchor against the topic.
      if (!topicId || !anchor || toolMessageIds.length === 0) return;
      await scan(topicId, anchor, toolMessageIds.slice(-MAX_SCAN_MESSAGES)).catch(report);
    },

    /** A main-agent tool call's result landed. */
    resolve: (toolCallId: string, toolMessageId: string | undefined, isError: boolean) => {
      const assistantMessageId = liveCalls.get(toolCallId);
      liveCalls.delete(toolCallId);
      if (!topicId || !assistantMessageId || !toolMessageId || isError) return;
      anchorId ??= assistantMessageId;
      const anchor = anchorId;
      liveChain = liveChain
        .then(async () => {
          // The anchor and this tool result may still sit in the write batcher.
          await persist(anchor);
          await scan(topicId, anchor, [toolMessageId]);
        })
        .catch(report);
    },

    /** A main-agent tool call was issued by `assistantMessageId`. */
    track: (toolCallId: string, assistantMessageId: string, args?: string) => {
      const command = commandOf(args);
      if (command && LIVE_WORK_COMMAND.test(command)) liveCalls.set(toolCallId, assistantMessageId);
    },
  };
};
