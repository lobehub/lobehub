import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export const isGzipPayload = (buf: Buffer): boolean =>
  buf.byteLength >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;

export const encodeCasPayload = async (raw: Buffer): Promise<Buffer> =>
  Buffer.from(await gzipAsync(raw, { level: 9 }));

export const decodeCasPayload = async (buf: Buffer): Promise<Buffer> => {
  if (!isGzipPayload(buf)) return buf;
  return Buffer.from(await gunzipAsync(buf));
};
