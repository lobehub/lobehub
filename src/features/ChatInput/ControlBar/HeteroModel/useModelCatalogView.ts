import type {
  HeterogeneousAgentModel,
  HeterogeneousAgentModelCatalogSuccess,
} from '@lobechat/types';
import { HETEROGENEOUS_AGENT_DEFAULT_SELECTION } from '@lobechat/types';
import { useMemo } from 'react';

interface ModelCatalogViewParams {
  currentModel: string;
  data?: HeterogeneousAgentModelCatalogSuccess;
  savedLabel: string;
  search: string;
}

/** Keep saved selections and successful catalogs usable through loading and discovery failures. */
export const useModelCatalogView = ({
  currentModel,
  data,
  savedLabel,
  search,
}: ModelCatalogViewParams) =>
  useMemo(() => {
    const catalogModels = data?.models ?? [];
    const selectedIsMissing =
      currentModel !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION &&
      !catalogModels.some((item) => item.id === currentModel);
    const all: HeterogeneousAgentModel[] = selectedIsMissing
      ? [
          {
            id: currentModel,
            modelId: currentModel.includes('/')
              ? currentModel.slice(currentModel.indexOf('/') + 1)
              : currentModel,
            providerId: savedLabel,
          },
          ...catalogModels,
        ]
      : catalogModels;
    const query = search.trim().toLowerCase();
    const rows = query
      ? all.filter((item) =>
          [item.id, item.label, item.providerId, item.modelId].some(
            (value) => value && value.toLowerCase().includes(query),
          ),
        )
      : all;
    const groups = rows.reduce<Record<string, HeterogeneousAgentModel[]>>((result, item) => {
      (result[item.providerId] ||= []).push(item);
      return result;
    }, {});
    return { groups, rows, selectedIsStale: selectedIsMissing && !!data };
  }, [currentModel, data, savedLabel, search]);
