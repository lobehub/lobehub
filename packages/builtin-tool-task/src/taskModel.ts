/**
 * Task-level model override as the task tools accept it. `null` clears the
 * override; omitted keeps whatever the task already carries.
 */
export interface TaskModelParams {
  model?: string | null;
  provider?: string | null;
}

// A type alias, not an interface, so it stays assignable to `config` records.
export type TaskModelConfig = {
  model?: string | null;
  provider?: string | null;
};

// Models fill optional strings with "" — that means "not passed", never a clear,
// or an edit that only renames the task would wipe its model. Only `null` (or
// the string "null", which some models send instead) clears.
const readValue = (value: string | null | undefined): string | null | undefined => {
  if (value === null) return null;
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.toLowerCase() === 'null' ? null : trimmed;
};

const TASK_PROVIDER_WITHOUT_MODEL_ERROR =
  'provider needs model: pass the model it serves, or omit both to use the assignee agent model.';

/**
 * `config` fields for a new task. Only explicit values are written; anything
 * missing is filled from the assignee agent's snapshot by the server
 * (`resolveMissingTaskModelConfig`), the same as a task created without one.
 */
export const toCreateTaskModelConfig = (params: TaskModelParams): TaskModelConfig | undefined => {
  const model = readValue(params.model);
  const provider = readValue(params.provider);
  // The server would pair it with the agent's model, which that provider may not serve.
  if (provider && !model) throw new Error(TASK_PROVIDER_WITHOUT_MODEL_ERROR);
  const config: TaskModelConfig = {};
  if (model) config.model = model;
  if (provider) config.provider = provider;
  return Object.keys(config).length > 0 ? config : undefined;
};

/**
 * Deep-merge patch for an existing task's `config`.
 *
 * - `model: null` clears model and provider: the next run snapshots the
 *   assignee agent's model again.
 * - A model without a provider clears the stored provider, so the run resolves
 *   it the way a model-only task always has instead of pairing the new model
 *   with the previous provider.
 */
export const toTaskModelConfigPatch = (params: TaskModelParams): TaskModelConfig | undefined => {
  const model = readValue(params.model);
  const provider = readValue(params.provider);
  if (model === undefined && provider === undefined) return undefined;
  if (model === null) return { model: null, provider: null };
  if (model === undefined) return { provider };
  return { model, provider: provider ?? null };
};

/** One-line change summary for an applied {@link toTaskModelConfigPatch} result. */
export const describeTaskModelChange = (patch: TaskModelConfig): string => {
  if (patch.model === null) return 'model cleared (follows the assignee agent)';
  if (patch.model) return `model → ${patch.provider ? `${patch.provider}/` : ''}${patch.model}`;
  return patch.provider ? `provider → ${patch.provider}` : 'provider cleared';
};
