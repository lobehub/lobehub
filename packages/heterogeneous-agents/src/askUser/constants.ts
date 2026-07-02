/**
 * Public constants shared between the producer-side MCP server (Node-only)
 * and the consumer-side adapter / renderer (browser-safe). Kept in a
 * dependency-free module so importers don't accidentally pull node:http
 * etc. into the renderer bundle.
 */

/** MCP server name as it appears in the tool name prefix. */
export const ASK_USER_MCP_SERVER_NAME = 'lobe_cc';

/** MCP tool name (without the `mcp__lobe_cc__` prefix). */
export const ASK_USER_TOOL_NAME = 'ask_user_question';

/** Full tool name as the CC model sees it on the wire. */
export const ASK_USER_TOOL_FULL_NAME = `mcp__${ASK_USER_MCP_SERVER_NAME}__${ASK_USER_TOOL_NAME}`;

/**
 * Stable apiName the adapter rewrites the MCP tool to so that downstream
 * UI / persistence routes on a clean key, not the wire-prefixed MCP name.
 */
export const ASK_USER_API_NAME = 'askUserQuestion';

/**
 * How long the server holds a pending ask-user question before it times out
 * into a `cancelled` answer. This is the **authoritative** clock — the client
 * countdown (`builtin-tool-claude-code` `draft.ts` `COUNTDOWN_MS`) mirrors this
 * value and must be kept in sync (that package has no dep on this one, so it
 * can't import the const directly).
 */
export const DEFAULT_ASK_USER_TIMEOUT_MS = 10 * 60 * 1000;
