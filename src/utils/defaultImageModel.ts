import { ModelProvider } from 'model-bank/modelProvider';

export const DEFAULT_AI_IMAGE_PROVIDER = ModelProvider.Google;
export const DEFAULT_AI_IMAGE_MODEL = 'gemini-3.1-flash-image:image';

/**
 * Minimal shape of an enabled image provider with its enabled image models, in display order.
 * Both the client store's `enabledImageModelList` and the server runtime state can produce it.
 */
export interface EnabledImageProviderModels {
  children: { id: string }[];
  id: string;
}

export interface ImageModelSelection {
  model: string;
  provider: string;
}

/**
 * Pick the image model to use when the caller leaves the model and/or provider unset.
 *
 * This is the single source of the default-image-model rule shared by the image page and the
 * `image.createImage` endpoint (used by `lh gen image` without `-m` / `-p`):
 *
 * 1. With `model` given, the first enabled provider (restricted to `provider` if given) serving it.
 * 2. Otherwise `DEFAULT_AI_IMAGE_MODEL`, preferring `DEFAULT_AI_IMAGE_PROVIDER`, then any other
 *    enabled provider that serves it (on Cloud this is usually the `lobehub` provider).
 * 3. Otherwise the first enabled image model.
 *
 * The image page additionally tries the user's last selection first; that preference is stored
 * on the client only, so it stays in `useFetchAiImageConfig`.
 *
 * @returns `undefined` when no enabled model matches.
 */
export const resolveImageModelSelection = (
  providers: EnabledImageProviderModels[],
  { model, provider }: { model?: string; provider?: string } = {},
): ImageModelSelection | undefined => {
  const candidates = provider ? providers.filter((item) => item.id === provider) : providers;
  const servesModel = (item: EnabledImageProviderModels, id: string) =>
    item.children.some((child) => child.id === id);

  if (model) {
    const matched = candidates.find((item) => servesModel(item, model));
    return matched ? { model, provider: matched.id } : undefined;
  }

  const defaultProvider =
    candidates.find(
      (item) => item.id === DEFAULT_AI_IMAGE_PROVIDER && servesModel(item, DEFAULT_AI_IMAGE_MODEL),
    ) ?? candidates.find((item) => servesModel(item, DEFAULT_AI_IMAGE_MODEL));
  if (defaultProvider) return { model: DEFAULT_AI_IMAGE_MODEL, provider: defaultProvider.id };

  const firstProvider = candidates.find((item) => item.children.length > 0);
  const firstModel = firstProvider?.children[0];
  return firstProvider && firstModel
    ? { model: firstModel.id, provider: firstProvider.id }
    : undefined;
};
