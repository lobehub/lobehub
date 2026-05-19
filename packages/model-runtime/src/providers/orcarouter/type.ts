export interface OrcaRouterPricingEntry {
  cache_ratio?: number;
  completion_ratio?: number;
  context_length?: number;
  create_cache_ratio?: number;
  input_modalities?: string[] | null;
  max_completion_tokens?: number;
  model_name: string;
  model_ratio: number;
  output_modalities?: string[] | null;
  supported_endpoint_types?: string[] | null;
  supported_parameters?: string[] | null;
}
