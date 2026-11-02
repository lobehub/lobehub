import { type EnabledProviderWithModels } from '@/types/aiProvider';

/**
 * Merges a second typed model list into a base one, grouped by provider.
 *
 * Use when:
 * - A picker accepts more than one model type, such as a slot that takes chat and decision models.
 *
 * Before:
 * - base `[{ id: 'openrouter', children: [chat] }]`, extra `[{ id: 'openrouter', children: [decision] }]`
 *
 * After:
 * - `[{ id: 'openrouter', children: [chat, decision] }]`
 */
export const mergeProviderModelLists = (
  base: EnabledProviderWithModels[],
  extra: EnabledProviderWithModels[],
): EnabledProviderWithModels[] => {
  if (extra.length === 0) return base;

  const merged = base.map((provider) => ({ ...provider, children: [...provider.children] }));
  for (const provider of extra) {
    if (provider.children.length === 0) continue;
    const target = merged.find((item) => item.id === provider.id);
    if (!target) {
      merged.push({ ...provider, children: [...provider.children] });
      continue;
    }
    const known = new Set(target.children.map((model) => model.id));
    target.children.push(...provider.children.filter((model) => !known.has(model.id)));
  }
  return merged;
};
