import type { EnabledProviderWithModels } from '@/types/aiProvider';

/**
 * Nano Banana 2 Lite leads: it accepts multiple style-reference images
 * (gpt-image-2 caps `imageUrls` at one) and is the cheapest per image, which
 * is what the one-click brand-style avatar path relies on.
 */
const PREFERRED_ARTWORK_MODELS = ['gemini-3.1-flash-lite-image', 'gpt-image-2'];

// Image variants of chat models carry an `:image` suffix (e.g.
// `gemini-3.1-flash-lite-image:image`), standalone image models do not.
const baseModelId = (id: string) => id.split(':')[0];

export const selectAgentArtworkModel = (providers: EnabledProviderWithModels[]) => {
  for (const preferred of PREFERRED_ARTWORK_MODELS) {
    for (const provider of providers) {
      const model = provider.children.find(({ id }) => baseModelId(id) === preferred);
      if (model) return { model, provider };
    }
  }

  const provider = providers[0];
  const model = provider?.children[0];

  return provider && model ? { model, provider } : undefined;
};
