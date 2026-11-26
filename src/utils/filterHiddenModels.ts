import type { EnabledProviderWithModels } from '@/types/aiProvider';

/**
 * Drop the models `isHidden` leaves out, and any provider left without a model.
 * Returns the list unchanged (same reference) when nothing is hidden.
 */
export const filterHiddenModels = (
  enabledList: EnabledProviderWithModels[],
  isHidden?: (modelId: string, providerId: string) => boolean,
): EnabledProviderWithModels[] => {
  if (!isHidden) return enabledList;

  let changed = false;
  const filtered = enabledList.flatMap((provider) => {
    const children = provider.children.filter((model) => !isHidden(model.id, provider.id));
    if (children.length === provider.children.length) return [provider];

    changed = true;
    return children.length > 0 ? [{ ...provider, children }] : [];
  });

  return changed ? filtered : enabledList;
};
