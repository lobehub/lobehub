// BFL API Types

export enum BflStatusResponse {
  ContentModerated = 'Content Moderated',
  Error = 'Error',
  Pending = 'Pending',
  Ready = 'Ready',
  RequestModerated = 'Request Moderated',
  TaskNotFound = 'Task not found',
}

export interface BflAsyncResponse {
  id: string;
  polling_url: string;
}

export interface BflAsyncWebhookResponse {
  id: string;
  status: string;
  webhook_url: string;
}

export interface BflResultResponse {
  details?: Record<string, any> | null;
  id: string;
  preview?: Record<string, any> | null;
  progress?: number | null;
  result?: any;
  status: BflStatusResponse;
}

// Kontext series request (flux-kontext-pro, flux-kontext-max)
export interface BflFluxKontextRequest {
  aspect_ratio?: string | null;
  input_image?: string | null;
  input_image_2?: string | null;
  input_image_3?: string | null;
  input_image_4?: string | null;
  output_format?: 'jpeg' | 'png' | null;
  prompt: string;
  prompt_upsampling?: boolean;
  safety_tolerance?: number;
  seed?: number | null;
  webhook_secret?: string | null;
  webhook_url?: string | null;
}

// FLUX 1.1 Pro request
export interface BflFluxPro11Request {
  height?: number;
  image_prompt?: string | null;
  output_format?: 'jpeg' | 'png' | null;
  prompt?: string | null;
  prompt_upsampling?: boolean;
  safety_tolerance?: number;
  seed?: number | null;
  webhook_secret?: string | null;
  webhook_url?: string | null;
  width?: number;
}

// FLUX 1.1 Pro Ultra request
export interface BflFluxPro11UltraRequest {
  aspect_ratio?: string;
  prompt: string;
  raw?: boolean;
  safety_tolerance?: number;
  seed?: number | null;
}

// FLUX Pro request
export interface BflFluxProRequest {
  guidance?: number;
  height?: number;
  image_prompt?: string | null;
  prompt?: string | null;
  safety_tolerance?: number;
  seed?: number | null;
  steps?: number;
  width?: number;
}

// FLUX Dev request
export interface BflFluxDevRequest {
  guidance?: number;
  height?: number;
  image_prompt?: string | null;
  prompt: string;
  safety_tolerance?: number;
  seed?: number | null;
  steps?: number;
  width?: number;
}

// Model endpoint mapping
export const BFL_ENDPOINTS = {
  'flux-dev': '/v1/flux-dev',
  'flux-kontext-max': '/v1/flux-kontext-max',
  'flux-kontext-pro': '/v1/flux-kontext-pro',
  'flux-pro': '/v1/flux-pro',
  'flux-pro-1.1': '/v1/flux-pro-1.1',
  'flux-pro-1.1-ultra': '/v1/flux-pro-1.1-ultra',
} as const;

export type BflModelId = keyof typeof BFL_ENDPOINTS;

// Union type for all request types
export type BflRequest =
  | BflFluxKontextRequest
  | BflFluxPro11Request
  | BflFluxPro11UltraRequest
  | BflFluxProRequest
  | BflFluxDevRequest;
