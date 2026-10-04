import { useState } from 'react';

interface ConversationTarget {
  agentId: string;
  /** Absent opens the agent's side conversation rather than a specific topic. */
  topicId?: string;
}

interface PanelState {
  goalId: string;
  open: boolean;
  request: number;
  target?: ConversationTarget;
}

/** Keep the selected conversation within this goal's inspection session. */
export const useGoalChatPanel = (goalId: string, responsibleAgentId?: string) => {
  const [state, setState] = useState<PanelState>({ goalId, open: false, request: 0 });
  const current: PanelState = state.goalId === goalId ? state : { goalId, open: false, request: 0 };

  if (state.goalId !== goalId) setState(current);

  return {
    agentId: current.target?.agentId ?? responsibleAgentId,
    open: current.open,
    /**
     * Send the panel to one destination: the supervision record when the target
     * names a topic, the agent's side conversation otherwise. Re-targeting bumps
     * `request` because the panel remounts on the new conversation.
     */
    openConversation: (target: ConversationTarget) => {
      setState({ goalId, open: true, request: current.request + 1, target });
    },
    request: current.request,
    setOpen: (open: boolean) => setState({ ...current, open }),
    topicId: current.target?.topicId,
  };
};
