import type { PartialDeep } from 'type-fest';

import type { VersionResponseData } from '@/app/(backend)/api/version/route';
import { BusinessGlobalService } from '@/business/client/services/BusinessGlobalService';
import { lambdaClient } from '@/libs/trpc/client';
import { type LobeAgentConfig } from '@/types/agent';
import { type GlobalRuntimeConfig } from '@/types/serverConfig';

const VERSION_URL = 'https://registry.npmmirror.com/@lobehub/chat/latest';
const SERVER_VERSION_URL = '/api/version';

class GlobalService extends BusinessGlobalService {
  /**
   * get latest version from npm
   */
  getLatestVersion = async (): Promise<string> => {
    const res = await fetch(VERSION_URL);
    const data = await res.json();

    return data['version'];
  };

  /**
   * get server version from /api/version
   * @returns version string if available, null if server doesn't support version API (old server)
   */
  getServerVersion = async (): Promise<string | null> => {
    try {
      const res = await fetch(SERVER_VERSION_URL);

      if (!res.ok) {
        return null;
      }

      const data: VersionResponseData = await res.json();

      return data.version;
    } catch {
      return null;
    }
  };

  getGlobalConfig = async (): Promise<GlobalRuntimeConfig> => {
    return lambdaClient.config.getGlobalConfig.query();
  };

  getDefaultAgentConfig = async (): Promise<PartialDeep<LobeAgentConfig>> => {
    return lambdaClient.config.getDefaultAgentConfig.query();
  };
}

export const globalService = new GlobalService();
