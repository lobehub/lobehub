import type { UIChatMessage } from '@lobechat/types';

/** The part of `agent_runtime_end.data` that decides how the run's messages settle. */
export interface RuntimeEndData {
  messagePatchMode?: boolean;
  messageRevision?: number;
  reason?: string;
  uiMessages?: UIChatMessage[];
}

interface ReconcileRuntimeEndParams {
  /** Replaces the store's list with the terminal snapshot the server pushed. */
  applySnapshot: (messages: UIChatMessage[]) => void;
  /** The store's current list for this conversation. */
  currentMessages: () => UIChatMessage[];
  data: RuntimeEndData | undefined;
  /** Server-confirmed state (an assistant id, streamed output, a snapshot) has arrived. */
  hasStreamedContent: boolean;
  /** A newer operation owns the conversation, so this run must not replace its list. */
  isSuperseded: boolean;
  /** Revision of the last `message_patch` this run applied. */
  lastMessagePatchRevision: number;
  /** Revision the last `step_start` announced, kept even when its read failed. */
  lastStepStartRevision: number;
  /**
   * Reads the conversation into the store; `undefined` when a newer snapshot won
   * or a newer operation took the conversation while the read was in flight.
   */
  refresh: () => Promise<UIChatMessage[] | undefined>;
}

interface ReconcileRuntimeEndResult {
  lastMessagePatchRevision: number;
  /** This run's final messages when known, for the terminal notification. */
  terminalMessages?: UIChatMessage[];
}

/**
 * Brings the store to the run's final messages on `agent_runtime_end`, before
 * the terminal run lifecycle's notification reads the final assistant content.
 *
 * The terminal step has no later `step_start` to carry the source of truth, so
 * the server pushes the canonical snapshot on this event. A DB refetch is the
 * fallback when it is absent (older server builds, push-event delivery edge
 * cases).
 */
export const reconcileRuntimeEndMessages = async ({
  applySnapshot,
  currentMessages,
  data,
  hasStreamedContent,
  isSuperseded,
  lastMessagePatchRevision,
  lastStepStartRevision,
  refresh,
}: ReconcileRuntimeEndParams): Promise<ReconcileRuntimeEndResult> => {
  if (Array.isArray(data?.uiMessages)) {
    // `visible_output_end` lets a follow-up start before this terminal
    // event arrives. Once that happens, this run's snapshot is no longer
    // the conversation SoT: replacing the list would erase the newer
    // turn's optimistic rows until refresh. Keep terminalMessages for
    // this run's notification, but do not mutate its successor's store.
    if (!isSuperseded) applySnapshot(data.uiMessages);
    return { lastMessagePatchRevision, terminalMessages: data.uiMessages };
  }

  if (data?.reason === 'interrupted' && hasStreamedContent) {
    // MID-stream cancel. `interruptOperation` publishes this event as soon as
    // it saves `interrupted`, while the in-flight step persists the partial
    // text only when it returns afterwards. Any DB read here sees the empty
    // placeholder and wipes the streamed text, and nothing repairs it: the
    // socket closes on this frame. Keep what was streamed — the server
    // persists the same. Without streamed content, the optimistic `tmp_*`
    // rows are all we have and still need the refetch below.
    //
    // In patch mode a Stop mid-step ends one revision past the step it
    // landed in: the later of the last applied patch and the last
    // `step_start`, which still names that step when its read failed. Two or
    // more past means a step that already finished is missing: a step
    // that continues inline publishes its patch only from the next step's
    // entry read, so a Stop between the two steps overtakes it, and this
    // frame is the last one the client gets. That step is persisted and the
    // next one has not streamed yet, so read it; otherwise its changes (a
    // compressed group, fields the stream never carried) stay stale until a
    // reload. A newer send that already owns the conversation keeps its own
    // list: replacing it would erase that turn's optimistic rows.
    if (
      !isSuperseded &&
      data.messagePatchMode &&
      typeof data.messageRevision === 'number' &&
      data.messageRevision - Math.max(lastMessagePatchRevision, lastStepStartRevision) >= 2
    ) {
      const messages = await refresh().catch((error) => {
        console.error(error);
        return undefined;
      });
      if (messages) {
        return { lastMessagePatchRevision: data.messageRevision, terminalMessages: messages };
      }
    }
    return { lastMessagePatchRevision };
  }

  if (data?.messagePatchMode) {
    if (
      typeof data.messageRevision === 'number' &&
      data.messageRevision !== lastMessagePatchRevision
    ) {
      const messages = await refresh();
      return messages
        ? { lastMessagePatchRevision: data.messageRevision, terminalMessages: messages }
        : { lastMessagePatchRevision };
    }
    return { lastMessagePatchRevision, terminalMessages: currentMessages() };
  }

  if (data?.reason === 'waiting_for_async_tool' && hasStreamedContent) {
    // Deferred-tool pause. The server's `AgentRuntimeCoordinator.resolveUiMessages`
    // omits uiMessages for it (as for `interrupted`) so the in-memory streamed
    // content is preserved here instead of racing the executor's DB write.
    return { lastMessagePatchRevision };
  }

  if (!isSuperseded) await refresh().catch(console.error);
  return { lastMessagePatchRevision };
};
