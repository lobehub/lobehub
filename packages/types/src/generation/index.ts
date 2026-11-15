import type { AsyncTaskError, AsyncTaskStatus } from '../asyncTask';

export interface GenerationTopicCreator {
  avatar?: string | null;
  fullName?: string | null;
  id: string;
  username?: string | null;
}

export interface ImageGenerationTopic {
  coverUrl?: string | null;
  createdAt: Date;
  creator?: GenerationTopicCreator | null;
  id: string;
  title?: string | null;
  updatedAt: Date;
  visibility?: 'private' | 'public' | null;
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
  /** Provider interaction id used to continue stateful video editing. */
  interactionId?: string;
  originalUrl?: string;
  /** Previous generated version used as the editing source. */
  previousGenerationId?: string;
  thumbnailUrl?: string;
  url?: string;
  width?: number;
}

/**
 * A generated song. `url` / `coverUrl` are storage keys in our own file storage (resolve with
 * `FileService.getFullFileUrl`); `originalUrl` is the provider's temporary URL.
 */
export interface MusicGenerationAsset extends BaseGenerationAsset {
  coverUrl?: string;
  /** Track length in seconds */
  duration?: number;
  /** Lyrics the provider used, when it returned them */
  lyrics?: string;
  mimeType?: string;
  originalUrl?: string;
  /** Provider-side track id */
  providerTrackId?: string;
  /** Style tags the provider applied */
  tags?: string;
  title?: string;
  type: 'audio';
  url?: string;
}

/**
 * Assets of image and video generations. Music assets are stored in the same column but kept
 * out of this union, which image/video UI code reads `width` / `thumbnailUrl` from; narrow on
 * `type === 'audio'` to read a {@link MusicGenerationAsset}.
 */
export type GenerationAsset = ImageGenerationAsset | VideoGenerationAsset;

export interface GenerationConfig {
  aspectRatio?: string;
  cfg?: number;
  endImageUrl?: string | null;
  height?: number;
  imageUrl?: string | null;
  imageUrls?: string[];
  previousGenerationId?: string;
  prompt: string;
  /** Music cover reference track: a storage key in the DB, a full URL once read */
  referenceAudioUrl?: string | null;
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
  /**
   * Library file the generated asset was saved as, once the task succeeded.
   */
  fileId?: string | null;
  id: string;
  /**
   * Source generation this one edits, read from the async task metadata so the
   * version link is available while the edit is still generating.
   */
  previousGenerationId?: string;
  seed?: number | null;

  task: GenerationAsyncTask;
}

export interface GenerationBatch {
  avgLatencyMs?: number | null;
  config?: GenerationConfig;
  createdAt: Date;
  creator?: GenerationTopicCreator | null;
  generations: Generation[];
  height?: number | null;
  id: string;
  model: string;
  prompt: string;
  provider: string;
  width?: number | null;
}
