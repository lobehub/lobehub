// Electron projects route state through the single ActiveConversationBridge,
// which follows activeTabId. Keeping this hook inert prevents every visible
// split-pane router from subscribing to and rewriting the global conversation.
interface ChatRouteSyncOptions {
  getConversationPath?: (agentId: string) => string;
  getTopicPath?: (agentId: string, topicId: string) => string;
}

export const useChatRouteSync = (_options: ChatRouteSyncOptions = {}) => {};
