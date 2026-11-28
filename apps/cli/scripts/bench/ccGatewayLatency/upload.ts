import path from 'node:path';
import { deflateSync } from 'node:zlib';

import { getTrpcClient } from '../../../src/api/client';
import { uploadFileBuffer, uploadLocalFile } from '../../../src/utils/uploadLocalFile';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (bytes: Buffer) => {
  let c = 0xff_ff_ff_ff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xff_ff_ff_ff) >>> 0;
};

const chunk = (type: string, data: Buffer) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

/**
 * A screenshot-sized (1280×800) RGB PNG with bands and a grid, generated so the
 * bench needs no binary fixture. Pass `--image` to measure a real screenshot.
 */
export const createBenchPng = (width = 1280, height = 800): Buffer => {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      const grid = x % 80 === 0 || y % 80 === 0;
      row[1 + x * 3] = grid ? 30 : (x * 255) / width;
      row[2 + x * 3] = grid ? 30 : (y * 255) / height;
      row[3 + x * 3] = grid ? 30 : 160;
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

let cached: Promise<string> | undefined;

/** Upload once per bench session; the send that attaches it is what is timed. */
export const uploadBenchImage = (imagePath?: string): Promise<string> => {
  cached ??= (async () => {
    const client = await getTrpcClient();
    const file = imagePath
      ? await uploadLocalFile(client, path.resolve(imagePath))
      : await uploadFileBuffer(client, {
          buffer: createBenchPng(),
          fileName: 'lobehub-bench.png',
          fileType: 'image/png',
        });
    return (file as { id: string }).id;
  })();
  return cached;
};
