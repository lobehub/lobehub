import type {
  AntigravityQuotaParams,
  AntigravityQuotaSnapshot,
} from '@lobechat/heterogeneous-agents/quota';

import { lambdaClient } from '@/libs/trpc/client';

import { heterogeneousAgentService } from './electron/heterogeneousAgent';

class AntigravityQuotaService {
  async getQuota({
    deviceId,
    ...params
  }: AntigravityQuotaParams & { deviceId?: string }): Promise<AntigravityQuotaSnapshot> {
    if (!deviceId) return heterogeneousAgentService.getAntigravityQuota(params);
    const result = await lambdaClient.device.getAntigravityQuota.query({ deviceId, ...params });
    if (!result) throw new Error('Antigravity quota is unavailable on this device');
    return result;
  }
}

export const antigravityQuotaService = new AntigravityQuotaService();
