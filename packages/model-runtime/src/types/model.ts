export interface ModelDetail {
  details?: {
    families?: string[];
    family?: string;
    format?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
  digest?: string;
  id: string;
  modified_at?: Date;
  name?: string;
  size?: number;
}

export interface ModelProgressResponse {
  completed?: number;
  digest?: string;
  model?: string;
  status: string;
  total?: number;
}

export interface ModelsParams {
  name?: string;
}

export interface PullModelParams {
  insecure?: boolean;
  model: string;
  stream?: boolean;
}

export interface ModelDetailParams {
  model: string;
}

export interface DeleteModelParams {
  model: string;
}

export interface ModelRequestOptions {
  signal?: AbortSignal;
}
