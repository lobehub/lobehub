import type { HeterogeneousAgentModel } from '@lobechat/types';
import { ANTIGRAVITY_REASONING_EFFORT_LEVELS } from '@lobechat/types';

/** agy models reports each thinking tier as a separate slug and display label. */
export const groupAntigravityModels = (
  models: HeterogeneousAgentModel[],
): HeterogeneousAgentModel[] => {
  const grouped = new Map<string, HeterogeneousAgentModel>();

  for (const model of models) {
    const { label } = model;
    const effort = ANTIGRAVITY_REASONING_EFFORT_LEVELS.find(
      (level) => model.id.endsWith(`-${level}`) && label?.toLowerCase().endsWith(` (${level})`),
    );
    if (!effort || !label) {
      const effortLevels = grouped.get(model.id)?.effortLevels;
      grouped.set(model.id, effortLevels ? { ...model, effortLevels } : model);
      continue;
    }

    const id = model.id.slice(0, -effort.length - 1);
    const existing = grouped.get(id);
    grouped.set(id, {
      id,
      label: label.slice(0, -effort.length - 3),
      modelId: id,
      providerId: model.providerId,
      ...existing,
      effortLevels: ANTIGRAVITY_REASONING_EFFORT_LEVELS.filter(
        (level) => level === effort || existing?.effortLevels?.includes(level),
      ),
    });
  }

  return [...grouped.values()];
};

/** Resolve a previously selected native variant once the execution device confirms it. */
export const findAntigravityVariant = (
  models: HeterogeneousAgentModel[] | undefined,
  modelId: string,
) => {
  if (models?.some(({ id }) => id === modelId)) return;

  for (const model of models ?? []) {
    const effort = model.effortLevels?.find((level) => `${model.id}-${level}` === modelId);
    if (effort) return { effort, model };
  }
};
