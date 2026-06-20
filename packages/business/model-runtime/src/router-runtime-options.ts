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

const parseModels = (...values: Array<string | undefined>): string[] | undefined => {
  const models = values
    .filter(Boolean)
    .flatMap((item) => item!.split(','))
    .map((item) => item.trim())
    .filter(Boolean);

  return models.length ? models : undefined;
};

export const lobehubRouterRuntimeOptions: LobehubRouterRuntimeOptions = {
  id: 'lobehub',

  routers: async (options, { model }) => {
    const apiKey = options?.apiKey || process.env.ACENSUS_AI_API_KEY;
    if (!apiKey) return [];

    return [
      {
        apiType: options?.apiType || process.env.ACENSUS_AI_API_TYPE || 'openai',
        models:
          parseModels(
            options?.models || process.env.ACENSUS_AI_MODELS,
            process.env.ACENSUS_AI_DEFAULT_MODEL,
          ) ?? (model ? [model] : undefined),
        options: {
          apiKey,
          baseURL:
            options?.baseURL || process.env.ACENSUS_AI_BASE_URL || 'https://api.cometapi.com/v1',
        },
      },
    ];
  },
};
