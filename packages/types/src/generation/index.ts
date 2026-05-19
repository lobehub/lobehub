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

export interface VideoGenerationAsset extends BaseGenerationAsset {
  coverUrl?: string;
  duration?: number;
  height?: number;
  originalUrl?: string;
  thumbnailUrl?: string;
  url?: string;
  width?: number;
}

export interface AudioGenerationAsset extends BaseGenerationAsset {
  /**
   * Duration of the audio in seconds
   */
  duration?: number;
  /**
   * CDN URL from the API provider, typically expires quickly
   */
  originalUrl?: string;
  /**
   * URL stored in own OSS
   */
  url?: string;
}

export type GenerationAsset = ImageGenerationAsset | VideoGenerationAsset | AudioGenerationAsset;

export interface AudioGenerationTopic {
  coverUrl?: string | null;
  createdAt: Date;
  id: string;
  title?: string | null;
  updatedAt: Date;
}

export interface GenerationConfig {
  aspectRatio?: string;
  cfg?: number;
  duration?: number; // For audio: 15-120 seconds
  endImageUrl?: string | null;
  height?: number;
  imageUrl?: string | null;
  imageUrls?: string[];
  musicStyle?: string; // For audio: pop|rock|jazz|lo-fi|classical|ambient|hip-hop
  prompt: string;
  resolution?: string;
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
  avgLatencyMs?: number | null;
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
