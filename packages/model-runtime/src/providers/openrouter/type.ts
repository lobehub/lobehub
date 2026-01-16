interface ModelPricing {
  completion: string;
  image?: string;
  input_cache_read?: string;
  input_cache_write?: string;
  internal_reasoning?: string;
  prompt: string;
  request?: string;
  web_search?: string;
}

interface TopProvider {
  context_length: number;
  is_moderated: boolean;
  max_completion_tokens: number | null;
}

interface Architecture {
  input_modalities: string[];
  instruct_type: string | null;
  modality: string;
  output_modalities: string[];
  tokenizer: string;
}

export interface OpenRouterModelCard {
  architecture: Architecture;
  canonical_slug: string;
  context_length: number;
  created: number;
  default_parameters?: any | null;
  description?: string;
  hugging_face_id?: string;
  id: string;
  name: string;
  per_request_limits?: any | null;
  pricing: ModelPricing;
  supported_parameters: string[];
  top_provider: TopProvider;
}

export interface OpenRouterReasoning {
  effort?: 'high' | 'medium' | 'low' | 'minimal';
  enabled?: boolean;
  exclude?: boolean;
  max_tokens?: number;
}
