import type {
  HeterogeneousAgentModelCatalog,
  ListHeterogeneousAgentModelsParams,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';
import { heterogeneousAgentService as electronHeterogeneousAgentService } from '@/services/electron/heterogeneousAgent';

interface ListModelsParams extends ListHeterogeneousAgentModelsParams {
  deviceId?: string;
}

/**
 * Model-catalog transport boundary. A bound target goes through the device
 * gateway; an unbound target is the current Desktop and uses Electron IPC.
 */
class HeterogeneousAgentCatalogService {
  listModels({ deviceId, ...params }: ListModelsParams): Promise<HeterogeneousAgentModelCatalog> {
    return deviceId
      ? lambdaClient.device.listHeterogeneousAgentModels.query({ deviceId, ...params })
      : electronHeterogeneousAgentService.listModels(params);
  }
}

export const heterogeneousAgentCatalogService = new HeterogeneousAgentCatalogService();
