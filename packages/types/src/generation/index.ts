import type { AsyncTaskError, AsyncTaskStatus } from '../asyncTask';

export interface ImageGenerationTopic {
  coverUrl?: string | null;
  createdAt: Date;
  id: string;
  title?: string | null;
  updatedAt: Date;
}

export interface BaseGenerationAsset {
  type: string;
}

export interface ImageGenerationAsset extends BaseGenerationAsset {
  /**
   * Height of the image/video
   */
  height?: number;
  /**
   * CDN URL from the API provider, typically expires quickly
   */
  originalUrl?: string;
  /**
   * Thumbnail URL - for images it's a resized version, for videos it's a thumbnail of the cover
   */
  thumbnailUrl?: string;
  /**
   * URL stored in own OSS, only the key is stored. The full URL needs to be obtained using FileService.getFullFileUrl
   */
  url?: string;
  /**
   * Width of the image/video
   */
  width?: number;
}

export type GenerationAsset = ImageGenerationAsset;

export interface GenerationConfig {
  aspectRatio?: string;
  cfg?: number;
  height?: number;
  imageUrl?: string | null;
  imageUrls?: string[];
  prompt: string;
  size?: string;
  steps?: number;
  width?: number;
}

export interface GenerationAsyncTask {
  error?: AsyncTaskError;
  id: string;
  status: AsyncTaskStatus;
}

export interface Generation {
  /**
   * The asset associated with the generation, containing image URLs and dimensions.
   */
  asset?: GenerationAsset | null;
  asyncTaskId: string | null;
  createdAt: Date;
  id: string;
  seed?: number | null;

  task: GenerationAsyncTask;
}

export interface GenerationBatch {
  config?: GenerationConfig;
  createdAt: Date;
  generations: Generation[];
  height?: number | null;
  id: string;
  model: string;
  prompt: string;
  provider: string;
  width?: number | null;
}
