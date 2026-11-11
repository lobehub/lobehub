/**
 * Desktop no-op. Every desktop tab is a keep-alive router, so the home layout
 * stays mounted in a hidden tab and its effects run again on every tab switch,
 * in a commit deferred behind the switch. Writing the shared `activeAgentId`
 * from here overwrote the agent of the tab the user switched to. The active-tab
 * `ActiveConversationBridge` projects the inbox agent for the home route instead.
 */
const HomeAgentIdSync = () => null;

export default HomeAgentIdSync;
