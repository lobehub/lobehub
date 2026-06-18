import { z } from 'zod';

import type { FileParsingTask } from '../asyncTask';

export interface FileUploadState {
  progress: number;
  /**
   * rest time in s
   */
  restTime: number;
  /**
   * upload speed in Byte/s
   */
  speed: number;
}

export type FileUploadStatus =
  | 'pending'
  | 'uploading'
  | 'processing'
  | 'success'
  | 'error'
  | 'cancelled';

export type FileProcessStatus = 'pending' | 'chunking' | 'embedding' | 'success' | 'error';

export const UPLOAD_STATUS_SET = new Set(['uploading', 'pending', 'processing']);

// the file that is upload at chat page
export interface UploadFileItem {
  /**
   * AbortController to cancel the upload
   */
  abortController?: AbortController;
  /**
   * base64 data, it will use in other data
   */
  base64Url?: string;
  file: File;
  /**
   * the file url after upload,it will be s3 url
   * if enable the S3 storage, or the data is same as base64Url
   */
  fileUrl?: string;
  id: string;
  /**
   * blob url for local preview
   * it will use in the file preview before send the message
   */
  previewUrl?: string;
  status: FileUploadStatus;
  tasks?: FileParsingTask;
  uploadState?: FileUploadState;
}

export const FileMetadataSchema = z.object({
  date: z.string(),
  dirname: z.string(),
  filename: z.string(),
  /**
   * intrinsic image height in pixels, recorded for images so consumers can
   * reserve layout space (avoid CLS) without loading the file first
   */
  height: z.number().optional(),
  path: z.string(),
  /**
   * intrinsic image aspect ratio (width / height), recorded for images so
   * consumers can group/reserve layout by orientation without recomputing
   */
  ratio: z.number().optional(),
  /**
   * intrinsic image width in pixels, recorded for images
   */
  width: z.number().optional(),
});

export type FileMetadata = z.infer<typeof FileMetadataSchema>;

export const UploadFileSchema = z.object({
  /**
   * file type
   * @example 'image/png'
   */
  fileType: z.string(),
  // TODO: Need be required
  hash: z.string().optional(),

  knowledgeBaseId: z.string().optional(),

  metadata: z.any().optional(),

  /**
   * file name
   * @example 'test.png'
   */
  name: z.string(),

  /**
   * the mode database save the file
   * local mean save the raw file into data
   * url mean upload the file to a cdn and then save the url
   */
  /**
   * file size
   */
  size: z.number(),

  /**
   * file source
   */
  source: z.string().optional(),

  /**
   * file url if saveMode is url
   */
  url: z.string().optional(),
});

export type UploadFileParams = z.infer<typeof UploadFileSchema>;

export interface CheckFileHashResult {
  fileType?: string;
  isExist: boolean;
  metadata?: unknown;
  size?: number;
  url?: string;
}

export interface UploadBase64ToS3Result {
  fileType: string;
  hash: string;
  metadata: FileMetadata;
  size: number;
}
