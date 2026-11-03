import { lambdaClient } from '@/libs/trpc/client';
import {
  type AiProviderDetailItem,
  type AiProviderRuntimeState,
  type AiProviderSortMap,
  type CreateAiProviderParams,
  type UpdateAiProviderConfigParams,
} from '@/types/aiProvider';

export class AiProviderService {
  createAiProvider = async (params: CreateAiProviderParams) => {
    return lambdaClient.aiProvider.createAiProvider.mutate(params);
  };

  getAiProviderList = async () => {
    return lambdaClient.aiProvider.getAiProviderList.query();
  };

  getAiProviderById = async (id: string): Promise<AiProviderDetailItem | undefined> => {
    return lambdaClient.aiProvider.getAiProviderById.query({ id });
  };

  toggleProviderEnabled = async (id: string, enabled: boolean) => {
    return lambdaClient.aiProvider.toggleProviderEnabled.mutate({ enabled, id });
  };

  updateAiProvider = async (id: string, value: any) => {
    return lambdaClient.aiProvider.updateAiProvider.mutate({ id, value });
  };

  updateAiProviderConfig = async (id: string, value: UpdateAiProviderConfigParams) => {
    return lambdaClient.aiProvider.updateAiProviderConfig.mutate({ id, value });
  };

  updateAiProviderOrder = async (items: AiProviderSortMap[]) => {
    return lambdaClient.aiProvider.updateAiProviderOrder.mutate({ sortMap: items });
  };

  deleteAiProvider = async (id: string) => {
    return lambdaClient.aiProvider.removeAiProvider.mutate({ id });
  };

  getAiProviderRuntimeState = async (isLogin?: boolean): Promise<AiProviderRuntimeState> => {
    return lambdaClient.aiProvider.getAiProviderRuntimeState.query({ isLogin });
  };
}

export const aiProviderService = new AiProviderService();
