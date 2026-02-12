/**
 * File service implementation interface
 */
export interface FileServiceImpl {
  /**
   * Create pre-signed upload URL
   */
  createPreSignedUrl: (key: string) => Promise<string>;
  /**
   * Create pre-signed preview URL
   */
  createPreSignedUrlForPreview: (key: string, expiresIn?: number) => Promise<string>;

  /**
   * Delete file
   */
  deleteFile: (key: string) => Promise<any>;

  /**
   * Delete files in batch
   */
  deleteFiles: (keys: string[]) => Promise<any>;

  /**
   * Get file byte array
   */
  getFileByteArray: (key: string) => Promise<Uint8Array>;

  /**
   * Get file content
   */
  getFileContent: (key: string) => Promise<string>;

  /**
   * Get file metadata from storage
   * Used to verify actual file size instead of trusting client-provided values
   */
  getFileMetadata: (key: string) => Promise<{ contentLength: number; contentType?: string }>;

  /**
   * Get full file URL
   */
  getFullFileUrl: (url?: string | null, expiresIn?: number) => Promise<string>;

  /**
   * Extract key from full URL
   */
  getKeyFromFullUrl: (url: string) => Promise<string | null>;

  /**
   * Upload content
   */
  uploadContent: (path: string, content: string) => Promise<any>;

  /**
   * Upload media file
   */
  uploadMedia: (key: string, buffer: Buffer) => Promise<{ key: string }>;
}
