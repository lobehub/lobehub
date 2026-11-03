interface HFArchitecture {
  input_modalities: string[];
  output_modalities: string[];
}

interface HFProviderInfo {
  context_length?: number;
  is_model_author?: boolean;
  pricing?: {
    input?: number;
    output?: number;
  };
  provider: string;
  status: string;
  supports_structured_output?: boolean;
  supports_tools?: boolean;
}

export interface HuggingFaceRouterModelCard {
  architecture: HFArchitecture;
  created: number;
  id: string;
  object: string;
  owned_by: string;
  providers: HFProviderInfo[];
}

export interface HuggingFaceRouterResponse {
  data: HuggingFaceRouterModelCard[];
  object: string;
}
