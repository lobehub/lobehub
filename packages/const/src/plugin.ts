export const PLUGIN_SCHEMA_SEPARATOR = '____';
export const PLUGIN_SCHEMA_API_MD5_PREFIX = 'MD5HASH_';

/**
 * Canonical parse for a raw `TOOL_NAME_MAX_LENGTH` value — the length at which a
 * function-call tool name is compressed into an opaque `MD5HASH_…` name, `0`
 * turning that compression off.
 *
 * Returns `undefined` for unset / unparseable / negative input, meaning "not
 * configured": callers fall back to the default rather than failing, because a
 * typo in this var must never take a deployment down.
 *
 * Lives here, in a leaf module, because the var is read from two sides:
 * `ToolNameResolver` reads `process.env` directly on the server, while the app
 * ships the value to the browser with the global server config (the
 * client-driven chat path generates tool names where `process.env` isn't
 * visible). Parsing it with two different rule sets would let one env value mean
 * two different things, and the same tool could get different names on each side.
 */
export const parseToolNameMaxLength = (raw: string | undefined): number | undefined => {
  if (raw === undefined || raw === '') return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

export const ARTIFACT_TAG = 'lobeArtifact';
export const ARTIFACT_THINKING_TAG = 'lobeThinking';
export const MENTION_TAG = 'mention';
export const THINKING_TAG = 'think';
export const LOCAL_FILE_TAG = 'localFile';
export const SKILL_TAG = 'skill';
export const TASK_TAG = 'task';
/** Provider activity (CI failure, review feedback) injected into a conversation by the SCM integration. */
export const SCM_EVENT_TAG = 'scmEvent';
/** One goal manager planning turn: why it started, what changed since the last one, and the standing contract. */
export const GOAL_TURN_TAG = 'goalTurn';
export const TOOL_TAG = 'tool';
export const USER_FEEDBACK_TAG = 'user_feedback';
// https://regex101.com/r/TwzTkf/2
export const ARTIFACT_TAG_REGEX = /<lobeArtifact\b[^>]*>(?<content>[\S\s]*?)(?:<\/lobeArtifact>|$)/;

// https://regex101.com/r/r9gqGg/1
export const ARTIFACT_TAG_CLOSED_REGEX = /<lobeArtifact\b[^>]*>([\S\s]*?)<\/lobeArtifact>/;

// https://regex101.com/r/AvPA2g/1
export const ARTIFACT_THINKING_TAG_REGEX = /<lobeThinking\b[^>]*>([\S\s]*?)(?:<\/lobeThinking>|$)/;

export const THINKING_TAG_REGEX = /<think\b[^>]*>([\S\s]*?)(?:<\/think>|$)/;

export const MENTION_TAG_REGEX = /<mention\b[^>]*>([\S\s]*?)(?:<\/mention>|$)/;

export const AGENTS_TAG = 'lobeAgents';
export const AGENTS_TAG_REGEX = /<lobeAgents\b[^>]*(?:\/>|>([\S\s]*?)(?:<\/lobeAgents>|$))/;

/**
 * `user_connectors.metadata` key a marketplace MCP install sets once it has
 * finished. An OAuth callback can still connect a row after the user canceled
 * the install, so a connected marketplace row is callable only with this mark
 * (or, for installs made before connectors, a `user_installed_plugins` row).
 */
export const MARKETPLACE_INSTALL_COMPLETED_KEY = 'marketplaceInstalled';

export const isMarketplaceInstallCompleted = (metadata: unknown): boolean =>
  !!metadata &&
  typeof metadata === 'object' &&
  (metadata as Record<string, unknown>)[MARKETPLACE_INSTALL_COMPLETED_KEY] === true;

/**
 * `user_connectors.metadata` key a custom MCP installed from a protocol link
 * sets. Those installs used to be custom plugins, whose stdio calls ran on the
 * desktop over IPC with or without a device gateway.
 */
export const DESKTOP_STDIO_EXECUTION_KEY = 'desktopStdioExecution';

/**
 * Whether a stdio connector's conversation calls stay on the desktop that makes
 * them even when a device gateway is configured (the connector route refuses
 * stdio): marketplace and protocol-link installs, which ran there as plugins.
 */
export const keepsDesktopStdioExecution = (connector: {
  metadata?: unknown;
  sourceType?: string | null;
}): boolean =>
  connector.sourceType === 'marketplace' ||
  (!!connector.metadata &&
    typeof connector.metadata === 'object' &&
    (connector.metadata as Record<string, unknown>)[DESKTOP_STDIO_EXECUTION_KEY] === true);

/**
 * A connector the tool runtime can call: an HTTP URL, a stdio command, or a
 * marketplace server the market hosts (`cloud`). Rows without one only
 * project tools another executor runs.
 */
export const hasCallableMcpEndpoint = (connector: {
  mcpConnectionType?: string | null;
  mcpServerUrl?: string | null;
}): boolean =>
  !!connector.mcpServerUrl ||
  connector.mcpConnectionType === 'stdio' ||
  connector.mcpConnectionType === 'cloud';

/**
 * Whether a connector's tools may run as far as its marketplace install goes.
 * A base marketplace row with an endpoint needs a finished install (its own
 * mark, or a pre-connector plugin row: `hasPluginRow`) and a connected status.
 * A reinstall or an OAuth re-authorization rewrites the endpoint and leaves the
 * row disconnected until its tools sync, so neither the plugin row nor the mark
 * may run the old tools against the new endpoint meanwhile. Other rows and
 * agent-owned copies pass.
 */
export const isMarketplaceInstallRunnable = (
  connector: {
    agentId?: string | null;
    mcpConnectionType?: string | null;
    mcpServerUrl?: string | null;
    metadata?: unknown;
    sourceType?: string | null;
    status?: string | null;
  },
  hasPluginRow: boolean,
): boolean =>
  !!connector.agentId ||
  connector.sourceType !== 'marketplace' ||
  !hasCallableMcpEndpoint(connector) ||
  (connector.status === 'connected' &&
    (hasPluginRow || isMarketplaceInstallCompleted(connector.metadata)));
