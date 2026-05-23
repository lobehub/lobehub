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
