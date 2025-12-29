export interface StraicoModelPricing {
  base_cost?: number;
  coins?: number;
  per_word_cost?: number;
  words?: number;
}

export interface StraicoAudioModel {
  _id: string;
  enabled: boolean;
  model: string;
  name: string;
  pricing: StraicoModelPricing;
  provider: string;
}

export interface StraicoModelMetadata {
  applications?: string[];
  capabilities?: string[];
  cons?: string[];
  editors_choice_level?: number;
  editors_link?: string;
  features?: string[];
  icon?: string;
  other?: any[];
  pros?: string[];
}

export interface StraicoChatModel {
  _id?: string;
  enabled?: boolean;
  max_output?: number;
  metadata?: StraicoModelMetadata;
  model: string;
  name: string;
  pricing: StraicoModelPricing;
  word_limit?: number;
}

export interface StraicoModelsResponse {
  data: {
    audio?: StraicoAudioModel[];
    chat?: StraicoChatModel[];
  };
}
