/**
 * Desktop: `ActiveConversationBridge` in the Electron shell owns `activeAgentId`
 * and projects the inbox agent onto the Home route itself, the same way the
 * agent layout's `useAgentIdStoreSync.desktop` defers to it.
 *
 * Home lives in a keep-alive tab pane that commits on a deferred lane, after the
 * shell bridge. Writing from here let a hidden Home pane's cleanup clear the
 * agent the bridge had just projected for the newly active tab, and the next
 * agent config fetch (often the inbox) then adopted itself as active, so the
 * agent sidebar header showed the inbox agent over another agent's topic.
 */
const HomeAgentIdSync = () => null;

export default HomeAgentIdSync;
