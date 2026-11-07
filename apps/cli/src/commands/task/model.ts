/**
 * `--model` / `--provider` values. `null` or `none` clears the field; an
 * omitted flag leaves it alone.
 */
export interface TaskModelOptions {
  model?: string;
  provider?: string;
}

type ModelConfig = { model?: string | null; provider?: string | null };

const CLEAR_VALUES = new Set(['none', 'null']);

// An empty value is no flag at all; only an explicit none/null clears.
const readFlag = (value: string | undefined): string | null | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return CLEAR_VALUES.has(trimmed.toLowerCase()) ? null : trimmed;
};

/**
 * `config` for `task create`. Only explicit values are sent; a missing model or
 * provider is filled from the assignee agent's snapshot by the server, as for a
 * task created in the app.
 */
export const toCreateModelConfig = (options: TaskModelOptions) => {
  const model = readFlag(options.model);
  const provider = readFlag(options.provider);
  // The server would pair it with the agent's model, which that provider may not serve.
  if (provider && !model) throw new Error('--provider requires --model');
  const config: { model?: string; provider?: string } = {};
  if (model) config.model = model;
  if (provider) config.provider = provider;
  return Object.keys(config).length > 0 ? config : undefined;
};

/**
 * Deep-merge `configPatch` for `task edit`, matching the app's model picker:
 * - `--model null` clears model and provider; the next run uses the assignee
 *   agent's model again.
 * - `--model` without `--provider` clears the stored provider, so the server
 *   resolves it from the assignee agent rather than pairing the new model with
 *   the previous provider.
 */
export const toModelConfigPatch = (options: TaskModelOptions): ModelConfig | undefined => {
  const model = readFlag(options.model);
  const provider = readFlag(options.provider);
  if (model === undefined && provider === undefined) return undefined;
  if (model === null) return { model: null, provider: null };
  if (model === undefined) return { provider };
  return { model, provider: provider ?? null };
};

/**
 * The model line of `task view`. A model on the task is pinned to it — set
 * explicitly or snapshotted from the assignee at creation; without one the
 * next run takes the assignee agent's current model.
 */
export const formatTaskModel = (
  config: Record<string, unknown> | null | undefined,
  agentModel?: { model?: string | null; provider?: string | null } | null,
): string => {
  const model = typeof config?.model === 'string' ? config.model : undefined;
  const provider = typeof config?.provider === 'string' ? config.provider : undefined;
  if (!model) return 'follows assignee agent';

  const label = provider ? `${provider}/${model}` : model;
  if (!agentModel?.model) return `${label} (pinned)`;
  const sameAsAgent =
    agentModel.model === model &&
    (!provider || !agentModel.provider || agentModel.provider === provider);
  return `${label} (${sameAsAgent ? 'pinned, same as agent default' : 'override'})`;
};
