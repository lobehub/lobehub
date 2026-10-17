import { isHeterogeneousAgentModelId } from '@lobechat/const';

/**
 * Fills only missing Task model/provider fields from the assignee's snapshot.
 *
 * Use when:
 * - Creating a Task or backfilling a legacy model-only Task before execution.
 *
 * Expects:
 * - An unchanged Agent wrapper snapshot and the resolved model override provider.
 * - Null override provider for API auth that cannot supply a personal binding.
 *
 * Returns:
 * - Missing fields only, without replacing an explicit model or provider.
 * - A native runtime or personal API provider for model-only overrides, never an
 *   incompatible wrapper provider. Runtime-ID snapshots retain their original pair.
 *
 * Call stack:
 * TaskService.createTask / TaskRunnerService.runTask
 *   -> resolveMissingTaskModelConfig
 *     -> resolveRunAgentConfig (run-time application)
 */
export const resolveMissingTaskModelConfig = (
  config: Record<string, unknown> | null | undefined,
  snapshot: { model: string; provider: string },
  modelOverrideProvider?: string | null,
): { model?: string; provider?: string } => {
  const model = typeof config?.model === 'string' ? config.model : undefined;
  const hasProvider = typeof config?.provider === 'string';
  if (model === undefined) {
    return hasProvider ? { model: snapshot.model } : snapshot;
  }
  if (hasProvider) return {};

  // Runtime IDs remain wrapper snapshots, never API or native model overrides.
  if (!model || isHeterogeneousAgentModelId(model)) return { provider: snapshot.provider };
  // Missing/server-default API bindings must remain unbound; dispatch applies its guard.
  if (modelOverrideProvider === null) return {};
  return { provider: modelOverrideProvider ?? snapshot.provider };
};
