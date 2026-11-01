export interface BlobPersistResult {
  fileId: string;
  key: string;
  url: string;
}

export interface BlobRef {
  fileId?: string | null;
  id?: string | null;
  url?: string | null;
}

/**
 * Persists model-generated blobs (base64 images) and resolves stored file
 * references to externally accessible URLs. Server adapter wraps `FileService`
 * (S3); the client adapter can be a no-op / browser-backed implementation.
 */
export interface BlobStore {
  persistBase64: (base64Data: string, pathname: string) => Promise<BlobPersistResult>;
  resolveUrl: (ref: BlobRef) => Promise<string>;
}
