/**
 * Business slot: the conversation of a shared Agent inside a host website's
 * embed panel (`/embed/agent/:slugOrId`).
 *
 * The visitor's conversation runs on the creator's account, so it ships with
 * the deployment that does that accounting — the same reason the Agent Share
 * visitor page is a slot. This open-source default reports "not supported" and
 * renders nothing; the embed page then shows its unavailable state.
 */
export interface AgentEmbedChatProps {
  /** Whether the page runs inside a host website's frame (and so can be closed). */
  framed: boolean;
  /** The visitor asked to close the panel. */
  onClose: () => void;
  onMessageSent: (topicId?: string) => void;
  onTopicCreated: (topicId: string) => void;
  slugOrId: string;
}

export const AGENT_EMBED_CHAT_SUPPORTED = false;

const AgentEmbedChat = (_props: AgentEmbedChatProps) => null;

export default AgentEmbedChat;
