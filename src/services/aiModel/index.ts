import {
  type AiModelReasoningConfig,
  type AiModelSortMap,
  type AiModelType,
  type AiProviderModelListItem,
  type CreateAiModelParams,
  type ToggleAiModelEnableParams,
  type UpdateAiModelParams,
} from 'model-bank';
import { isAiModelVisible } from 'model-bank/aiModel';

import { lambdaClient } from '@/libs/trpc/client';

export interface GetAiProviderModelListParams {
  enabled?: boolean;
  limit?: number;
  offset?: number;
  type?: AiModelType;
}

export class AiModelService {
  createAiModel = async (params: CreateAiModelParams) => {
    return lambdaClient.aiModel.createAiModel.mutate(params);
  };

  getAiProviderModelList = async (
    id: string,
    params?: GetAiProviderModelListParams,
  ): Promise<AiProviderModelListItem[]> => {
    const models = await lambdaClient.aiModel.getAiProviderModelList.query({ id, ...params });
    return models.filter(isAiModelVisible);
  };

  getAiModelById = async (id: string) => {
    return lambdaClient.aiModel.getAiModelById.query({ id });
  };

  toggleModelEnabled = async (params: ToggleAiModelEnableParams) => {
    return lambdaClient.aiModel.toggleModelEnabled.mutate(params);
  };

  updateAiModel = async (id: string, providerId: string, value: UpdateAiModelParams) => {
    return lambdaClient.aiModel.updateAiModel.mutate({ id, providerId, value });
  };

  getAiModelReasoningConfig = async (
    id: string,
    providerId: string,
  ): Promise<AiModelReasoningConfig | undefined> => {
    return lambdaClient.aiModel.getAiModelReasoningConfig.query({ id, providerId });
  };

  updateAiModelReasoningConfig = async (
    id: string,
    providerId: string,
    value: AiModelReasoningConfig,
  ) => {
    return lambdaClient.aiModel.updateAiModelReasoningConfig.mutate({ id, providerId, value });
  };

  batchUpdateAiModels = async (
    id: string,
    models: AiProviderModelListItem[],
    options?: { forceType?: AiModelType },
  ) => {
    return lambdaClient.aiModel.batchUpdateAiModels.mutate({ id, models, ...options });
  };

  batchToggleAiModels = async (id: string, models: string[], enabled: boolean) => {
    return lambdaClient.aiModel.batchToggleAiModels.mutate({ enabled, id, models });
  };

  clearModelsByProvider = async (providerId: string) => {
    return lambdaClient.aiModel.clearModelsByProvider.mutate({ providerId });
  };

  clearRemoteModels = async (providerId: string) => {
    return lambdaClient.aiModel.clearRemoteModels.mutate({ providerId });
  };

  updateAiModelOrder = async (providerId: string, items: AiModelSortMap[]) => {
    return lambdaClient.aiModel.updateAiModelOrder.mutate({ providerId, sortMap: items });
  };

  deleteAiModel = async (params: { id: string; providerId: string }) => {
    return lambdaClient.aiModel.removeAiModel.mutate(params);
  };
}

export const aiModelService = new AiModelService();
