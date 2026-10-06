import { isHeterogeneousAgentModelId } from '@lobechat/const';

/**
 * The model/provider fields a Task config is missing, filled from the assignee
 * Agent's snapshot. An explicit model is never replaced. A native model-only
 * override takes the runtime's provider instead of the snapshot's wrapper
 * provider (e.g. `codex/openai`), which would make the pair incompatible.
 */
export const resolveMissingTaskModelConfig = (
  config: Record<string, unknown> | null | undefined,
  snapshot: { model: string; provider: string },
  nativeModelProvider?: string,
): { model?: string; provider?: string } => {
  const model = typeof config?.model === 'string' ? config.model : undefined;
  const hasProvider = typeof config?.provider === 'string';
  if (model === undefined) {
    return hasProvider ? { model: snapshot.model } : snapshot;
  }
  if (hasProvider) return {};

  const isNativeModel = !!nativeModelProvider && !!model && !isHeterogeneousAgentModelId(model);
  return { provider: isNativeModel ? nativeModelProvider : snapshot.provider };
};
