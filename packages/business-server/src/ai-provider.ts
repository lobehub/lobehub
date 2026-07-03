import type { ProviderConfig } from '@lobechat/types';

export const resolveBusinessAiProviderConfig = async (params: {
  providerConfig: Record<string, ProviderConfig>;
  userId: string;
  workspaceId?: string;
}): Promise<Record<string, ProviderConfig>> => params.providerConfig;
