import type { EnabledProviderWithModels } from '@/types/aiProvider';

const PREFERRED_ARTWORK_MODEL = 'gpt-image-2';

export const selectAgentArtworkModel = (providers: EnabledProviderWithModels[]) => {
  for (const provider of providers) {
    const model = provider.children.find(({ id }) => id === PREFERRED_ARTWORK_MODEL);
    if (model) return { model, provider };
  }

  const provider = providers[0];
  const model = provider?.children[0];

  return provider && model ? { model, provider } : undefined;
};
