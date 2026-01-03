import type { PartialDeep } from 'type-fest';

import { BusinessGlobalService } from '@/business/client/services/BusinessGlobalService';
import { lambdaClient } from '@/libs/trpc/client';
import { type LobeAgentConfig } from '@/types/agent';
import { type GlobalRuntimeConfig } from '@/types/serverConfig';

const VERSION_URL = 'https://registry.npmmirror.com/@lobehub/chat/latest';

class GlobalService extends BusinessGlobalService {
  /**
   * get latest version from npm
   */
  getLatestVersion = async (): Promise<string> => {
    const res = await fetch(VERSION_URL);
    const data = await res.json();

    return data['version'];
  };

  getGlobalConfig = async (): Promise<GlobalRuntimeConfig> => {
    return lambdaClient.config.getGlobalConfig.query();
  };

  getDefaultAgentConfig = async (): Promise<PartialDeep<LobeAgentConfig>> => {
    return lambdaClient.config.getDefaultAgentConfig.query();
  };
}

export const globalService = new GlobalService();
