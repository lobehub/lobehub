import { OSS_GLM_PROVIDER, OSS_HOME_NEW_MODELS } from './starterModels';

export const useStarterModelDefaults = () => {
  return {
    defaultHomeNewModels: OSS_HOME_NEW_MODELS,
    fallbackChatProvider: OSS_GLM_PROVIDER,
  };
};
