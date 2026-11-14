export interface LiquidInferenceModelCard {
  context_length?: number;
  created?: number;
  id: string;
  /** Absent means a chat model. Other values, such as `image_generation`, use another endpoint. */
  kind?: string;
  /** Names of request parameters that an offer for this model supports, such as `tools`. */
  liquid_supported_parameters?: string[];
  max_tokens?: number;
  /** USD per million tokens. */
  min_input_rate?: number | null;
  min_output_rate?: number | null;
}
