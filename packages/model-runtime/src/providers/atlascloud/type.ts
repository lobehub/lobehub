export interface AtlasCloudModelCapabilities {
  functionCall?: boolean;
  function_calling?: boolean;
  image?: boolean;
  reasoning?: boolean;
  tools?: boolean;
  vision?: boolean;
}

export interface AtlasCloudModelPricing {
  cachedInput?: string | number;
  cached_input?: string | number;
  completion?: string | number;
  input?: string | number;
  output?: string | number;
  prompt?: string | number;
}

export interface AtlasCloudModelCard {
  capabilities?: AtlasCloudModelCapabilities;
  contextWindowTokens?: number;
  context_length?: number;
  created?: number | string;
  description?: string;
  id: string;
  maxOutput?: number;
  max_output?: number;
  name?: string;
  pricing?: AtlasCloudModelPricing;
}
