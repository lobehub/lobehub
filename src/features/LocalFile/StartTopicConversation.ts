import { createContext } from 'react';

/**
 * The conversation a folder reference was rendered in. "Start a topic in this
 * folder" acts on that conversation only — never on whatever the global
 * active agent/topic happens to be.
 */
export interface StartTopicConversation {
  agentId: string;
  topicId: string | null;
}

/**
 * Supplies the conversation to folder chips that cannot receive it as a prop
 * (e.g. rich-text user messages, whose nodes render headlessly). Absent outside
 * an eligible conversation, which keeps the action hidden.
 */
export const StartTopicConversationContext = createContext<StartTopicConversation | undefined>(
  undefined,
);
