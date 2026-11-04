/**
 * MCP Apps (SEP-1865) helpers shared by the MCP client and the chat UI.
 *
 * A tool opts into an interactive UI by pointing `_meta.ui.resourceUri` at a
 * `ui://` resource. After the call we stash that URI on the tool result state
 * (`state.mcpApp`) so the conversation can fetch the HTML and render it.
 */

import { getMcpToolVisibility, isMcpToolVisibleTo } from '@lobechat/const/mcpApp';

/** Capability key a client advertises to tell servers it can render MCP Apps. */
export const MCP_APPS_EXTENSION_ID = 'io.modelcontextprotocol/ui';
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';

/** Client capabilities that advertise MCP Apps support during `initialize`. */
export const MCP_APPS_CLIENT_CAPABILITIES = {
  extensions: { [MCP_APPS_EXTENSION_ID]: { mimeTypes: [MCP_APP_MIME_TYPE] } },
};

export interface McpAppToolState {
  /**
   * The desktop whose local MCP process (stdio, localhost / LAN) produced the
   * result. Its view and the view's calls run in that process, so only that
   * desktop can serve them.
   */
  deviceId?: string;
  resourceUri: string;
  /**
   * The MCP server that produced the result (`getMcpServerFingerprint`). The
   * view is only read from that server: the identifier may resolve to another
   * one now, which must not get this result's arguments and data.
   */
  server?: string;
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
export const isToolVisibleToApp = (tool: { _meta?: unknown } | undefined): boolean =>
  isMcpToolVisibleTo(getMcpToolVisibility(tool?._meta), 'app');

/**
 * Whether this tool may be in the model's tool list. A tool whose
 * `_meta.ui.visibility` leaves out `"model"` exists only for its view.
 */
export const isToolVisibleToModel = (tool: { _meta?: unknown } | undefined): boolean =>
  isMcpToolVisibleTo(getMcpToolVisibility(tool?._meta), 'model');

/**
 * The raw MCP tool result state. Server AgentRuntime calls persist the whole
 * processed result (`{ content, state, success }`) as the plugin state, so the
 * MCP result (with `mcpApp`) sits one level deeper there than on client calls.
 *
 * Only that host envelope is unwrapped, recognized by its text `content` and
 * boolean `success`. A client call's state is the server's own result, whose
 * `content` is an array, and the SDK keeps any extra field it returns: a
 * `state` it nests there is the server's, not ours, and is never unwrapped.
 */
export const unwrapMcpToolState = <T = any>(state: T): T => {
  const envelope = state as
    { content?: unknown; state?: { content?: unknown }; success?: unknown } | undefined;
  const inner = envelope?.state;
  const isHostEnvelope =
    typeof envelope?.content === 'string' && typeof envelope?.success === 'boolean';

  return isHostEnvelope && inner && typeof inner === 'object' && Array.isArray(inner.content)
    ? (inner as T)
    : state;
};

/** Read the MCP App reference a tool call stored on its result state. */
export const getMcpAppFromState = (state: unknown): McpAppToolState | undefined => {
  const mcpApp = (
    unwrapMcpToolState(state) as
      { mcpApp?: { deviceId?: unknown; resourceUri?: unknown; server?: unknown } } | undefined
  )?.mcpApp;
  if (!isUiUri(mcpApp?.resourceUri)) return;

  return {
    ...(typeof mcpApp.deviceId === 'string' && { deviceId: mcpApp.deviceId }),
    resourceUri: mcpApp.resourceUri,
    ...(typeof mcpApp.server === 'string' && { server: mcpApp.server }),
  };
};

/**
 * Whether this client can serve a result's view: one from a desktop's local
 * MCP process only on that desktop (`currentDeviceId` is this desktop's
 * stable device id, if any).
 */
export const canServeMcpAppHere = (
  mcpApp: McpAppToolState,
  currentDeviceId: string | null | undefined,
): boolean => !mcpApp.deviceId || mcpApp.deviceId === currentDeviceId;
