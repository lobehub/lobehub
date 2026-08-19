interface ModelPricing {
  completion: string;
  image?: string;
  image_output?: string;
  image_token?: string;
  input_cache_read?: string;
  input_cache_write?: string;
  internal_reasoning?: string;
  prompt: string;
  request?: string;
  video_output?: string;
  video_token?: string;
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

export interface OpenRouterImagePricingLine {
  billable: string;
  cost_usd: number;
  unit: 'image' | 'megapixel' | 'token' | string;
  variant?: string;
}

export interface OpenRouterImageEndpoint {
  pricing?: OpenRouterImagePricingLine[];
  provider_slug?: string;
  supported_parameters?: Record<string, { type?: string; values?: string[] }>;
}

export interface OpenRouterImageModelListItem {
  endpoints?: string;
  id: string;
}

export interface OpenRouterVideoModelCard {
  allowed_passthrough_parameters: string[];
  canonical_slug: string;
  created: number;
  description?: string;
  generate_audio: boolean | null;
  id: string;
  name: string;
  pricing_skus: Record<string, string>;
  seed: boolean | null;
  supported_aspect_ratios: string[] | null;
  supported_durations: number[] | null;
  supported_frame_images: string[] | null;
  supported_resolutions: string[] | null;
  supported_sizes: string[] | null;
}

export interface OpenRouterReasoning {
  effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  enabled?: boolean;
  exclude?: boolean;
  max_tokens?: number;
}
