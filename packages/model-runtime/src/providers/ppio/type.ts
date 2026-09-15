export interface PPIOModelCard {
  context_size: number;
  created: number;
  description: string;
  display_name: string;
  /** e.g. `['serverless', 'function-calling', 'structured-outputs', 'reasoning']` */
  features?: string[];
  id: string;
  /** e.g. `['text', 'image', 'video']` */
  input_modalities?: string[];
  input_token_price_per_m: number;
  max_output_tokens?: number;
  output_token_price_per_m: number;
  status: number;
  tags: string[];
  title: string;
}
