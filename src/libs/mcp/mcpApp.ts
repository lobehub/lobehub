/**
 * MCP Apps (SEP-1865) helpers shared by the MCP client and the chat UI.
 *
 * A tool opts into an interactive UI by pointing `_meta.ui.resourceUri` at a
 * `ui://` resource. After the call we stash that URI on the tool result state
 * (`state.mcpApp`) so the conversation can fetch the HTML and render it.
 */

/** Capability key a client advertises to tell servers it can render MCP Apps. */
export const MCP_APPS_EXTENSION_ID = 'io.modelcontextprotocol/ui';
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';

/** Client capabilities that advertise MCP Apps support during `initialize`. */
export const MCP_APPS_CLIENT_CAPABILITIES = {
  extensions: { [MCP_APPS_EXTENSION_ID]: { mimeTypes: [MCP_APP_MIME_TYPE] } },
};

export interface McpAppToolState {
  resourceUri: string;
}

const isUiUri = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('ui://');

/**
 * Read the UI resource URI a tool declares. Supports the current nested
 * `_meta.ui.resourceUri` and the deprecated flat `_meta["ui/resourceUri"]`.
 */
export const getToolUiResourceUri = (tool: { _meta?: unknown } | undefined): string | undefined => {
  const meta = tool?._meta as Record<string, any> | undefined;
  if (!meta) return;

  const uri = meta.ui?.resourceUri ?? meta['ui/resourceUri'];

  return isUiUri(uri) ? uri : undefined;
};

/**
 * Whether a view may call this tool (`tools/call` from the app). Its
 * `_meta.ui.visibility` lists who may: unset means `["model", "app"]`, and a
 * tool without `"app"` must be refused to views.
 */
export const isToolVisibleToApp = (tool: { _meta?: unknown } | undefined): boolean => {
  const visibility = (tool?._meta as { ui?: { visibility?: unknown } } | undefined)?.ui?.visibility;

  return !Array.isArray(visibility) || visibility.includes('app');
};

/**
 * The raw MCP tool result state. Server AgentRuntime calls persist the whole
 * processed result (`{ content, state, success }`) as the plugin state, so the
 * MCP result (with `mcpApp`) sits one level deeper there than on client calls.
 */
export const unwrapMcpToolState = <T = any>(state: T): T => {
  const inner = (state as { state?: { content?: unknown } } | undefined)?.state;

  return inner && typeof inner === 'object' && Array.isArray(inner.content) ? (inner as T) : state;
};

/** Read the MCP App reference a tool call stored on its result state. */
export const getMcpAppFromState = (state: unknown): McpAppToolState | undefined => {
  const mcpApp = (unwrapMcpToolState(state) as { mcpApp?: { resourceUri?: unknown } } | undefined)
    ?.mcpApp;

  return isUiUri(mcpApp?.resourceUri) ? { resourceUri: mcpApp.resourceUri } : undefined;
};
