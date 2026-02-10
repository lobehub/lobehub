import type { RouteAttemptInput } from './router-metrics';
import { routerMetricsService } from './router-metrics';

interface RouterInstance {
  apiType: string;
  models?: string[];
  options: {
    accessKeyId?: string;
    accessKeySecret?: string;
    apiKey?: string;
    apiVersion?: string;
    baseURL?: string;
    baseURLOrAccountID?: string;
    dangerouslyAllowBrowser?: boolean;
    region?: string;
    sessionToken?: string;
  };
}

interface LobehubRouterRuntimeOptions {
  id: string;
  onRouteAttempt?: (result: RouteAttemptInput) => void;
  routers: (options: any, runtimeContext: { model?: string }) => Promise<RouterInstance[]>;
}

export const lobehubRouterRuntimeOptions: LobehubRouterRuntimeOptions = {
  id: 'lobehub',

  onRouteAttempt: (result) => {
    routerMetricsService.recordAttempt(result).catch(console.error);
  },

  // eslint-disable-next-line unused-imports/no-unused-vars, @typescript-eslint/no-unused-vars
  routers: async (options, { model: _model }) => {
    return [];
  },
};
