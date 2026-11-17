/** One entry of the tools engine's `filteredTools`. */
interface FilteredTool {
  id: string;
  reason: 'disabled' | 'incompatible' | 'not_found';
}

/**
 * The tools the agent pins that this run could not offer because no source
 * produced a manifest for them: a LobeHub Skill or Composio app the caller has
 * not connected, a connector that has not synced its tools, an uninstalled
 * plugin, or a source whose discovery failed. The agent's prompt may still
 * describe these tools, so the run is otherwise silent about why the model
 * cannot call them.
 *
 * Tools the user disabled for this run are expected to be missing and are not
 * reported. Rule-disabled tools (`disabled`) and models without function
 * calling (`incompatible`) are explained elsewhere.
 */
export const findMissingPinnedTools = (params: {
  disabledPluginIds: readonly string[];
  filteredTools: readonly FilteredTool[] | undefined;
  pinnedPluginIds: readonly string[];
}): string[] => {
  const pinned = new Set(params.pinnedPluginIds);
  const disabled = new Set(params.disabledPluginIds);
  return [
    ...new Set(
      (params.filteredTools ?? [])
        .filter((tool) => tool.reason === 'not_found' && pinned.has(tool.id))
        .map((tool) => tool.id)
        .filter((id) => !disabled.has(id)),
    ),
  ];
};

/**
 * Log one structured warning per run that pins tools it cannot offer, so a
 * "the role says I have tool X but I don't" report can be traced to the run.
 */
export const warnMissingPinnedTools = (
  missing: string[],
  context: { agentId: string; topicId?: string; userId: string; workspaceId?: string },
) => {
  if (missing.length === 0) return;
  console.warn('[AiAgentService] pinned tools unavailable this run: no manifest was resolved', {
    ...context,
    missingToolIds: missing,
  });
};
