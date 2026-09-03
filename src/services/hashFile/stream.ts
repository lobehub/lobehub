import { sha256 } from 'js-sha256';

const HASH_BUFFER_SIZE = 4 * 1024 * 1024;

export type HashProgress = (progress: number) => void;

export const hashFileStream = async (
  file: File,
  signal?: AbortSignal,
  onProgress?: HashProgress,
): Promise<string> => {
  const hasher = sha256.create();
  const reader = file.stream().getReader({ mode: 'byob' });
  let buffer = new ArrayBuffer(HASH_BUFFER_SIZE);
  let loaded = 0;

  try {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new Error('Upload cancelled by user');

      const { done, value } = await reader.read(new Uint8Array(buffer));
      if (done) return hasher.hex();
      hasher.update(value);
      loaded += value.byteLength;
      onProgress?.(file.size > 0 ? Math.min(99, Math.floor((loaded / file.size) * 100)) : 0);
      buffer = value.buffer as ArrayBuffer;
    }
  } finally {
    reader.releaseLock();
  }
};
