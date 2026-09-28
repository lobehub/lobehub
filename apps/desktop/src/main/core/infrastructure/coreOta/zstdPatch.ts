import { promisify } from 'node:util';
import { zstdDecompress } from 'node:zlib';

const zstdDecompressAsync = promisify(zstdDecompress);

export const applyZstdPatch = async (oldContent: Buffer, patch: Buffer): Promise<Buffer> => {
  const out = await zstdDecompressAsync(patch, { dictionary: oldContent });
  return Buffer.from(out);
};
