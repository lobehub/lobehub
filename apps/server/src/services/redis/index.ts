import { deviceSystemInfo } from './deviceSystemInfo';
import { skillTools } from './skillTools';
import { workspaceRescan } from './workspaceRescan';

/** Business Redis API. Providers, keys and expiry policy stay inside each domain. */
export const redisService = { deviceSystemInfo, skillTools, workspaceRescan };
