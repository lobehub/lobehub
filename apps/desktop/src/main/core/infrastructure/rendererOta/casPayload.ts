import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

const gunzipAsync = promisify(gunzip);

const isGzipPayload = (buf: Buffer): boolean =>
  buf.byteLength >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;

export const decodeCasPayload = async (buf: Buffer): Promise<Buffer> => {
  if (!isGzipPayload(buf)) return buf;
  return Buffer.from(await gunzipAsync(buf));
};
