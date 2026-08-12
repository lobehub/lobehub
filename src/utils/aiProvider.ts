import type { BuiltinModelIdentifier, EnabledAiModel } from 'model-bank';
import { isAiModelVisible } from 'model-bank';

const getBuiltinModelIdentifierKey = ({ id, providerId }: BuiltinModelIdentifier) =>
  `${providerId}\u0000${id}`;

export const filterHiddenBuiltinModels = <T extends BuiltinModelIdentifier>(
  models: T[],
  hiddenModels: readonly BuiltinModelIdentifier[] | undefined,
): T[] => {
  if (!hiddenModels || hiddenModels.length === 0) return models;

  const hiddenModelKeys = new Set(hiddenModels.map(getBuiltinModelIdentifierKey));
  return models.filter((model) => !hiddenModelKeys.has(getBuiltinModelIdentifierKey(model)));
};

export const filterHiddenProviderModels = <T extends { id: string }>(
  models: T[],
  providerId: string,
  hiddenModels: readonly BuiltinModelIdentifier[] | undefined,
): T[] => {
  if (!hiddenModels || hiddenModels.length === 0) return models;

  const hiddenModelIds = new Set(
    hiddenModels.filter((model) => model.providerId === providerId).map((model) => model.id),
  );
  if (hiddenModelIds.size === 0) return models;

  return models.filter((model) => !hiddenModelIds.has(model.id));
};

export const filterEnabledProvidersByModelType = <T extends { id: string }>(
  providers: T[],
  enabledAiModels: EnabledAiModel[],
  type: EnabledAiModel['type'],
): T[] =>
  providers.filter((provider) =>
    enabledAiModels.some(
      (model) => model.providerId === provider.id && model.type === type && isAiModelVisible(model),
    ),
  );
