export interface NovitaModelCard {
  context_size: number;
  created: number;
  description: string;
  features?: string[];
  id: string;
  input_modalities?: string[];
  input_token_price_per_m: number;
  max_output_tokens?: number;
  model_type?: string;
  output_token_price_per_m: number;
  status: number;
  tags: string[];
  title: string;
}
