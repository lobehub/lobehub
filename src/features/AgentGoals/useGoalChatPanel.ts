import { useCallback, useState } from 'react';

interface ConversationTarget {
  agentId: string;
  /** Sent once into the conversation as soon as the panel mounts on it. */
  initialMessage?: string;
  /** Absent opens the agent's side conversation rather than a specific topic. */
  topicId?: string;
}

interface PanelState {
  /**
   * The panel waits for the goal's supervision record: a correction went to
   * the main Agent, whose turn opens the record a moment later.
   */
  awaitingRecord?: boolean;
  goalId: string;
  open: boolean;
  request: number;
  target?: ConversationTarget;
}

/** Keep the selected conversation within this goal's inspection session. */
export const useGoalChatPanel = (
  goalId: string,
  responsibleAgentId?: string,
  /** The goal's supervision record, once its main Agent has one. */
  record?: ConversationTarget,
) => {
  const [state, setState] = useState<PanelState>({ goalId, open: false, request: 0 });
  let current: PanelState = state.goalId === goalId ? state : { goalId, open: false, request: 0 };

  // The awaited record landed: the panel follows it, unless it is already there.
  if (current.awaitingRecord && record) {
    current =
      current.target?.topicId === record.topicId
        ? { ...current, awaitingRecord: false }
        : { goalId, open: true, request: current.request + 1, target: record };
  }
  if (current !== state) setState(current);

  // Stable, so a timer keyed on it is not restarted by every render.
  const stopAwaitingRecord = useCallback(
    () => setState((prev) => (prev.awaitingRecord ? { ...prev, awaitingRecord: false } : prev)),
    [],
  );

  return {
    agentId: current.target?.agentId ?? responsibleAgentId,
    /** Opened for a supervision record that does not exist yet; see `openAwaitingRecord`. */
    awaitingRecord: !!current.awaitingRecord,
    initialMessage: current.target?.initialMessage,
    /**
     * Acknowledge the handed-off message once the panel has sent or filled it in. The panel
     * remounts whenever a drill-down replaces it, so a component-local "sent"
     * flag would resend the message on the way back.
     */
    consumeInitialMessage: () => {
      if (current.target?.initialMessage === undefined) return;
      setState({ ...current, target: { ...current.target, initialMessage: undefined } });
    },
    open: current.open,
    /**
     * Send the panel to one destination: the supervision record when the target
     * names a topic, the agent's side conversation otherwise. Re-targeting bumps
     * `request` because the panel remounts on the new conversation.
     */
    openConversation: (target: ConversationTarget) => {
      setState({ goalId, open: true, request: current.request + 1, target });
    },
    /**
     * Open the panel on `fallback` now and move it to the supervision record as
     * soon as one exists — for a correction the main Agent takes up in a record
     * its turn has yet to open.
     */
    openAwaitingRecord: (fallback: ConversationTarget) => {
      setState({
        awaitingRecord: true,
        goalId,
        open: true,
        request: current.request + 1,
        target: fallback,
      });
    },
    request: current.request,
    /** Stop waiting for the record: the panel stays on the conversation it opened on. */
    stopAwaitingRecord,
    // A pending message survives folding the panel; only `consumeInitialMessage`
    // drops it, once the panel has actually handed it off.
    setOpen: (open: boolean) => setState({ ...current, open }),
    topicId: current.target?.topicId,
  };
};
