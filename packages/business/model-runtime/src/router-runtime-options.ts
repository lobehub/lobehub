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
  routers: (options: any, runtimeContext: { model?: string }) => Promise<RouterInstance[]>;
}

export const lobehubRouterRuntimeOptions: LobehubRouterRuntimeOptions = {
  id: 'lobehub',

  // eslint-disable-next-line unused-imports/no-unused-vars
  routers: async (options, { model: _model }) => {
    return [];
  },
};
