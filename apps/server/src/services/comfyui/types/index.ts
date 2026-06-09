import { type ComfyUIKeyVault } from '@lobechat/types';

export interface ComfyUIServiceConfig {
  baseURL: string;
  cacheTTL?: number;
  connectionTimeout?: number;
  enableCache?: boolean;
  enableDebug?: boolean;
  keyVault: ComfyUIKeyVault;
  maxRetries?: number;
}

export interface WorkflowBuildParams {
  cfgScale?: number;
  height?: number;
  imageUrl?: string;
  model?: string;
  prompt: string;
  seed?: number;
  steps?: number;
  strength?: number; // Standard parameter for image modification strength
  width?: number;
}

export interface WorkflowContext {
  clientService: any;
  modelResolverService: any;
}

export interface ProcessedImageResult {
  buffer: Buffer;
  format: string;
  height: number;
  size: number;
  width: number;
}

export interface ImagePreprocessOptions {
  format?: string;
  targetHeight?: number;
  targetWidth?: number;
}
