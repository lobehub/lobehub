import { sha256 } from 'js-sha256';

const HASH_BUFFER_SIZE = 4 * 1024 * 1024;

export type HashProgress = (progress: number) => void;

export const hashFileStream = async (
  file: File,
  signal?: AbortSignal,
  onProgress?: HashProgress,
): Promise<string> => {
  const hasher = sha256.create();

  // Read one slice at a time instead of a BYOB reader: Safari's `Blob.stream()` is not a
  // byte stream, so `getReader({ mode: 'byob' })` throws there. Memory still stays at one chunk.
  for (let loaded = 0; loaded < file.size;) {
    if (signal?.aborted) throw signal.reason ?? new Error('Upload cancelled by user');

    const chunk = await file.slice(loaded, loaded + HASH_BUFFER_SIZE).arrayBuffer();
    hasher.update(chunk);
    loaded += chunk.byteLength;
    onProgress?.(Math.min(99, Math.floor((loaded / file.size) * 100)));
  }

  return hasher.hex();
};
