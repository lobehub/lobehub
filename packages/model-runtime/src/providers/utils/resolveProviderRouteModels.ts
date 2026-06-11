import { detectModelProvider } from '../../utils/modelParse';

type ProviderKey = ReturnType<typeof detectModelProvider>;

export const resolveProviderRouteModels = (
  provider: ProviderKey,
  modelList: ReadonlyArray<{ id: string }>,
  requestedModel?: string,
): string[] => {
  const providerModels = modelList
    .map((model) => model.id)
    .filter((id) => detectModelProvider(id) === provider);

  if (!requestedModel || detectModelProvider(requestedModel) !== provider) return providerModels;

  return [...new Set([...providerModels, requestedModel])];
};
