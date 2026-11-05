import { sha256Hex } from './sha256';

/**
 * Who may call an MCP tool, per MCP Apps (SEP-1865) `_meta.ui.visibility`:
 * `"model"` is the agent's tool list, `"app"` is an interactive view's
 * `tools/call`.
 */
export type McpToolAudience = 'app' | 'model';

/** The `_meta.ui.visibility` a tool declares, or `undefined` when it declares none. */
export const getMcpToolVisibility = (meta: unknown): string[] | undefined => {
  const visibility = (meta as { ui?: { visibility?: unknown } } | undefined)?.ui?.visibility;
  if (!Array.isArray(visibility)) return;

  return visibility.filter((item): item is string => typeof item === 'string');
};

/**
 * Whether `audience` may call a tool with this declared visibility. Unset means
 * `["model", "app"]`, so tools that predate MCP Apps stay visible to both.
 */
export const isMcpToolVisibleTo = (
  visibility: readonly string[] | null | undefined,
  audience: McpToolAudience,
): boolean => !visibility || visibility.includes(audience);

/**
 * The `metadata` a synced tool row (`user_connector_tools.metadata`) keeps for
 * the visibility its MCP server declared; `null` when it declared none.
 */
export const buildMcpToolMetadata = (
  visibility: readonly string[] | undefined,
): { visibility: string[] } | null => (visibility ? { visibility: [...visibility] } : null);

/**
 * Whether `audience` may call a synced tool, read from the row `metadata`
 * {@link buildMcpToolMetadata} wrote. A row synced before visibility was
 * stored counts as unset.
 */
export const isSyncedMcpToolVisibleTo = (
  tool: { metadata?: Record<string, unknown> | null },
  audience: McpToolAudience,
): boolean => {
  const visibility = tool.metadata?.visibility;

  return isMcpToolVisibleTo(
    Array.isArray(visibility)
      ? visibility.filter((item): item is string => typeof item === 'string')
      : undefined,
    audience,
  );
};

/**
 * What a plugin manifest keeps beside its model-facing `api` for MCP Apps
 * views: the tools only views may call (visibility with "app" but not
 * "model"), and the `api` tools views may not call (no "app").
 */
export const partitionMcpToolsForViews = <T extends { _meta?: unknown; name: string }>(
  tools: readonly T[],
) => {
  const audiences = tools.map((tool) => {
    const visibility = getMcpToolVisibility(tool._meta);
    return {
      app: isMcpToolVisibleTo(visibility, 'app'),
      model: isMcpToolVisibleTo(visibility, 'model'),
      tool,
    };
  });

  return {
    appOnlyTools: audiences.filter(({ app, model }) => app && !model).map(({ tool }) => tool),
    modelOnlyToolNames: audiences
      .filter(({ app, model }) => model && !app)
      .map(({ tool }) => tool.name),
  };
};

interface UiResourceItem {
  _meta?: unknown;
  uri?: string;
}

const uiMetaOf = (item: UiResourceItem | undefined) =>
  (item?._meta as { ui?: unknown } | undefined)?.ui;

/** Whether some `resources/read` content item declares no `_meta.ui` of its own. */
export const lacksUiResourceMeta = (result: { contents?: readonly UiResourceItem[] }): boolean =>
  (result.contents ?? []).some((item) => !uiMetaOf(item));

/**
 * MCP Apps reads a view's `_meta.ui` (CSP, permissions, border) from its
 * `resources/read` content item, with its `resources/list` entry as the
 * fallback: a server may declare it once where it registers the resource.
 * Fill content items that declare none from the listing entry for `uri`.
 */
export const withListingUiMeta = <R extends { contents?: UiResourceItem[] }>(
  result: R,
  uri: string,
  listed: readonly UiResourceItem[] | undefined,
): R => {
  const listingUi = uiMetaOf(listed?.find((entry) => entry.uri === uri));
  if (!listingUi || !result.contents) return result;

  return {
    ...result,
    contents: result.contents.map((item) =>
      uiMetaOf(item)
        ? item
        : { ...item, _meta: { ...(item._meta as object | undefined), ui: listingUi } },
    ),
  };
};

/** The part of an MCP connection that says which server it reaches. */
export type McpServerAddress =
  | {
      /** Part of which server it is: a gateway may route by header (tenant, backend). */
      headers?: Record<string, string> | null;
      type: 'http';
      url: string;
    }
  | {
      args?: readonly string[];
      command: string;
      /** Part of which server it is: a stdio server may pick its endpoint by env. */
      env?: Record<string, string> | null;
      type: 'stdio';
    };

// Sorted, so the same entries name the same server in any order; none and `{}` alike
const withEntries = (base: string, entries: Record<string, string> | null | undefined) => {
  const sorted = Object.entries(entries ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted.length > 0 ? `${base} ${JSON.stringify(sorted)}` : base;
};

const serverIdentity = (address: McpServerAddress): string =>
  address.type === 'http'
    ? withEntries(`http ${address.url}`, address.headers)
    : withEntries(
        `stdio ${JSON.stringify([address.command, ...(address.args ?? [])])}`,
        address.env,
      );

/**
 * Names the MCP server a tool result came from without storing its address
 * (a URL or header may carry a token): a SHA-256 of the URL and headers, or of
 * the command, its arguments and environment. Auth (`params.auth`) is not part
 * of it: a refreshed token reaches the same server. A result's view is only read back from the server it names.
 */
export const getMcpServerFingerprint = async (address: McpServerAddress): Promise<string> => {
  // Not `crypto.subtle`: browsers leave it out of pages that aren't a secure context
  return sha256Hex(serverIdentity(address));
};
