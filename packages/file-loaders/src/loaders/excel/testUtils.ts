import { crc32, deflateRawSync } from 'node:zlib';

export interface TestZipEntry {
  /** Real uncompressed bytes. */
  data?: Buffer | string;
  /** Central-directory declared uncompressed size; defaults to the real data length. */
  declaredSize?: number;
  /** Store the data deflated (method 8) instead of stored (method 0). */
  deflate?: boolean;
  name: string;
}

/**
 * Builds a minimal ZIP in memory (stored, or deflated per entry). The declared size in the central
 * directory can differ from the real data, so size budgets are testable with tiny fixtures.
 */
export const buildTestZip = (entries: TestZipEntry[]): Buffer => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? '', 'utf8');
    const crc = crc32(data);
    const payload = entry.deflate ? deflateRawSync(data) : data;
    const method = entry.deflate ? 8 : 0;

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04_03_4b_50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, payload);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02_01_4b_50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(entry.declaredSize ?? data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);

    offset += local.length + payload.length;
  }

  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06_05_4b_50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, ...centrals, end]);
};
