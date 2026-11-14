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

/**
 * Whether a manifest tool's `humanIntervention` can resolve to one of
 * `policies`: the policy itself, any of its rules, or either outcome of a
 * dynamic config (its `policy`, `always` when unset, on a match; its `default`
 * otherwise). Callers that carry one policy per tool, where rules and
 * resolvers cannot run, read the strictest outcome from this.
 */
export const humanInterventionMayResolveTo = (
  humanIntervention: unknown,
  policies: readonly string[],
): boolean => {
  const matches = (policy: unknown) => typeof policy === 'string' && policies.includes(policy);
  const rules = Array.isArray(humanIntervention) ? humanIntervention : [humanIntervention];

  return rules.some((rule) => {
    if (!rule || typeof rule !== 'object') return matches(rule);

    const { dynamic, policy } = rule as { dynamic?: unknown; policy?: unknown };
    if (dynamic && typeof dynamic === 'object') {
      const { default: fallback, policy: onMatch = 'always' } = dynamic as {
        default?: unknown;
        policy?: unknown;
      };
      return matches(onMatch) || matches(fallback);
    }
    return matches(policy);
  });
};

/**
 * Whether a manifest tool can ask for `always` approval, the one no approval
 * mode waives (auto-run and headless skip `required`).
 */
export const mayRequireMandatoryApproval = (humanIntervention: unknown): boolean =>
  humanInterventionMayResolveTo(humanIntervention, ['always']);

/**
 * `user_connector_tools.metadata` key a synced tool sets when its manifest can
 * ask for `always` approval (a cloud marketplace MCP the market marks so). The
 * connector's manifest is built from the row, whose `needs_approval` becomes a
 * `required` that auto-run skips: the mark keeps the tool on `always`, whatever
 * its permission, as the plugin manifest kept it.
 */
export const MANDATORY_APPROVAL_KEY = 'mandatoryApproval';

export const hasMandatoryApproval = (metadata: unknown): boolean =>
  !!metadata &&
  typeof metadata === 'object' &&
  (metadata as Record<string, unknown>)[MANDATORY_APPROVAL_KEY] === true;

/** A synced tool's `metadata`, marked when its manifest `humanIntervention` can ask for `always`. */
export const withMandatoryApprovalMark = (
  metadata: Record<string, unknown> | null,
  humanIntervention: unknown,
): Record<string, unknown> | null =>
  mayRequireMandatoryApproval(humanIntervention)
    ? { ...metadata, [MANDATORY_APPROVAL_KEY]: true }
    : metadata;
