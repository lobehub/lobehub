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
