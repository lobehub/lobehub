import { sha256 } from 'js-sha256';
import { describe, expect, it, vi } from 'vitest';

import { hashFileStream } from './stream';

// Spans two 4 MB reads, with bytes that vary by position so a dropped or repeated chunk changes the hash.
const content = Uint8Array.from({ length: 4 * 1024 * 1024 + 1000 }, (_, index) => index % 251);

/** A file whose `stream()` is a default (non-byte) stream, as `Blob.stream()` is in Safari. */
const fileWithDefaultStream = (bytes: Uint8Array<ArrayBuffer>) => {
  const file = new File([bytes], 'a.bin');
  Object.defineProperty(file, 'stream', {
    value: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
  });
  return file;
};

describe('hashFileStream', () => {
  it('hashes a file whose stream is not a byte stream, as in Safari', async () => {
    await expect(hashFileStream(fileWithDefaultStream(content))).resolves.toBe(sha256(content));
  });

  it('hashes a file across several reads and keeps progress below 100', async () => {
    const onProgress = vi.fn();

    await expect(hashFileStream(new File([content], 'a.bin'), undefined, onProgress)).resolves.toBe(
      sha256(content),
    );
    expect(onProgress).toHaveBeenLastCalledWith(99);
  });

  it('hashes an empty file', async () => {
    await expect(hashFileStream(new File([], 'empty.bin'))).resolves.toBe(sha256(''));
  });

  it('stops with the abort reason when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));

    await expect(hashFileStream(new File([content], 'a.bin'), controller.signal)).rejects.toThrow(
      'cancelled',
    );
  });
});
