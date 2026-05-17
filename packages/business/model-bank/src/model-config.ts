import type { AiFullModelCard, AiModelType, Pricing } from 'model-bank';
import { loadModels as loadModelBankModels, ModelProvider } from 'model-bank';

export interface LobeHubModelConfig {
  models: AiFullModelCard[];
  planCardModels: string[];
  updatedAt?: string;
  version: number;
}

export const getDefaultLobeHubModelConfig = (): LobeHubModelConfig => ({
  models: [],
  planCardModels: [],
  version: 1,
});

export const loadLobeHubModelConfig = async (): Promise<LobeHubModelConfig> =>
  getDefaultLobeHubModelConfig();

export const loadModels = async () =>
  loadModelBankModels({
    providerLoaders: {
      [ModelProvider.LobeHub]: loadLobeHubModels,
    },
  });

export const loadLobeHubModels = async (): Promise<AiFullModelCard[]> =>
  (await loadLobeHubModelConfig()).models;

export const loadLobeHubPlanCardModels = async (): Promise<string[]> =>
  (await loadLobeHubModelConfig()).planCardModels;

export const findLobeHubModel = async (id: string): Promise<AiFullModelCard | undefined> =>
  (await loadLobeHubModels()).find((model) => model.id === id);

export const isLobeHubModelAvailable = async (
  id: string,
  expectedType: AiModelType,
): Promise<boolean> => {
  const model = await findLobeHubModel(id);
  return Boolean(model && model.type === expectedType);
};

export const getLobeHubModelPricing = async (id: string): Promise<Pricing | undefined> =>
  (await findLobeHubModel(id))?.pricing;
