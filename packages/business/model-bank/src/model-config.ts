import type { AiFullModelCard, AiModelType } from 'model-bank';
import { loadModels as loadModelBankModels, ModelProvider } from 'model-bank';

interface LobeHubModelConfig {
  models: AiFullModelCard[];
  planCardModels: string[];
  updatedAt?: string;
  version: number;
}

const getDefaultLobeHubModelConfig = (): LobeHubModelConfig => ({
  models: [],
  planCardModels: [],
  version: 1,
});

const loadLobeHubModelConfig = async (): Promise<LobeHubModelConfig> =>
  getDefaultLobeHubModelConfig();

export const loadModels = async () =>
  loadModelBankModels({
    providerLoaders: {
      [ModelProvider.LobeHub]: loadLobeHubModels,
    },
  });

const loadLobeHubModels = async (): Promise<AiFullModelCard[]> =>
  (await loadLobeHubModelConfig()).models;

export const loadLobeHubPlanCardModels = async (): Promise<string[]> =>
  (await loadLobeHubModelConfig()).planCardModels;

export const isLobeHubModelAvailable = (
  _id: string,
  _expectedType: AiModelType,
  _options?: {
    getUserEmail?: () => Promise<string | null | undefined>;
    userEmail?: string | null;
  },
): boolean => false;
