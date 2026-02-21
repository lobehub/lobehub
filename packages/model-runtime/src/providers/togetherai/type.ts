interface ModelInstanceConfig {
  appearsIn: any[]; // 你可以替换为实际类型
  order: number;
}

interface Config {
  add_generation_prompt: boolean;
  chat_template: string;
  prompt_format: string;
  stop: string[];
}

interface Pricing {
  hourly: number;
  input: number;
  output: number;
}

interface Instance {
  avzone: string;
  cluster: string;
}

interface Depth {
  asks: Record<string, number>;
  asks_updated: string;
  gpus: Record<string, number>;
  num_asks: number;
  num_bids: number;
  num_running: number;
  permit_required: boolean;
  price: {
    base: number;
    finetune: number;
    hourly: number;
    input: number;
    output: number;
  };
  qps: number;
  stats: {
    avzone: string;
    capacity: number;
    cluster: string;
    error_rate: number;
    qps: number;
    retry_rate: number;
    throughput_in: number;
    throughput_out: number;
  }[];
}

export interface TogetherAIModel {
  // eslint-disable-next-line typescript-sort-keys/interface
  access: string;
  config: Config;
  context_length: number;
  created_at: string;
  creator_organization: string;
  depth: Depth;
  description: string;
  descriptionLink: string;
  display_name: string;
  display_type: string;
  hardware_label: string;
  id: string;
  instances: Instance[];
  isFeaturedModel: boolean;
  license: string;
  link: string;
  modelInstanceConfig: ModelInstanceConfig;
  num_parameters: number;
  pricing: Pricing;
  show_in_playground: boolean;
  update_at: string;
}
