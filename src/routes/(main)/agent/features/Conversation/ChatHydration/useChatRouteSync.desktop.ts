// Electron projects route state through the single ActiveConversationBridge,
// which follows activeTabId. Keeping this hook inert prevents every visible
// split-pane router from subscribing to and rewriting the global conversation.
export const useChatRouteSync = () => {};
