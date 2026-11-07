import type { ServerConfigStore } from '@/store/serverConfig/store';

export const taskGatewayAvailability = ({
  serverConfig,
  serverConfigInit,
  serverConfigLoaded,
}: Pick<ServerConfigStore, 'serverConfig' | 'serverConfigInit' | 'serverConfigLoaded'>) => {
  if (!serverConfigInit) return 'loading';
  if (!serverConfigLoaded) return 'error';
  return serverConfig.enableGatewayMode && serverConfig.agentGatewayUrl
    ? 'available'
    : 'unavailable';
};
