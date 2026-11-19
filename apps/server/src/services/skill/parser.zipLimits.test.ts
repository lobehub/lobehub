import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { SkillParseError } from './errors';
import { SkillParser } from './parser';

/**
 * Rewrites the declared `originalSize` (uncompressed-size field) of entries in a
 * ZIP's central directory. Lets a ~200-byte fixture claim a huge decompressed
 * size — the shape of a real zip bomb — without materializing the payload in
 * the test, since the parser must reject on the declaration before inflating.
 */
const declareOriginalSizes = (zipped: Uint8Array, sizes: Record<string, number>): Uint8Array => {
  const bytes = Buffer.from(zipped); // writable copy
  for (let i = 0; i + 46 <= bytes.length;) {
    // Central directory record signature "PK\x01\x02"
    if (bytes.readUInt32LE(i) !== 0x02_01_4b_50) {
      i += 1;
      continue;
    }
    const nameLength = bytes.readUInt16LE(i + 28);
    const extraLength = bytes.readUInt16LE(i + 30);
    const commentLength = bytes.readUInt16LE(i + 32);
    const name = bytes.subarray(i + 46, i + 46 + nameLength).toString();
    const size = sizes[name];
    if (size !== undefined) bytes.writeUInt32LE(size, i + 24);
    i += 46 + nameLength + extraLength + commentLength;
  }
  return bytes;
};

// Regression tests for T-29: unzipBuffer used to decompress with no limits, so
// a tiny ZIP could declare huge entries and inflate into gigabytes inside a
// shared serverless process (zip bomb / memory DoS). fflate bounds each
// entry's output buffer by its declared `originalSize`, so the parser must
// reject oversized declarations before inflation starts.
describe('parseZipPackage unzip limits (T-29 regression)', () => {
  const parser = new SkillParser();
  const skillMd = '---\nname: bomb\ndescription: zip bomb\n---\ncontent';

  // Rejection is captured manually instead of `rejects.toThrow`: a resolved
  // ParsedZipSkill holds resource Buffers whose pretty-printed assertion diff
  // would bloat the test worker.
  const captureError = (zipped: Uint8Array) =>
    parser.parseZipPackage(Buffer.from(zipped)).catch((error: unknown) => error);

  it('should reject a single file over the extracted-size limit', async () => {
    const zipped = declareOriginalSizes(
      zipSync({ 'SKILL.md': strToU8(skillMd), 'payload.bin': strToU8('x') }),
      { 'payload.bin': 65 * 1024 * 1024 },
    );

    const error = await captureError(zipped);
    expect(error).toBeInstanceOf(SkillParseError);
    expect((error as Error).message).toMatch(/single-file limit/);
  });

  it('should reject when the cumulative extracted size exceeds the total limit', async () => {
    // Each file is under the single-file limit; together they exceed it.
    const zipped = declareOriginalSizes(
      zipSync({
        'SKILL.md': strToU8(skillMd),
        'a.bin': strToU8('x'),
        'b.bin': strToU8('x'),
        'c.bin': strToU8('x'),
      }),
      {
        'a.bin': 50 * 1024 * 1024,
        'b.bin': 50 * 1024 * 1024,
        'c.bin': 50 * 1024 * 1024,
      },
    );

    const error = await captureError(zipped);
    expect(error).toBeInstanceOf(SkillParseError);
    expect((error as Error).message).toMatch(/total extracted size limit/);
  });

  it(
    'should reject a ZIP with more entries than the file-count limit',
    { timeout: 30_000 },
    async () => {
      // level: 0 stores entries instead of deflating them, keeping this
      // 50k-entry fixture cheap on slow CI workers.
      const files: Record<string, Uint8Array> = { 'SKILL.md': strToU8(skillMd) };
      for (let i = 0; i < 50_000; i += 1) files[`f${i}.txt`] = strToU8('x');
      const zipped = zipSync(files, { level: 0 });

      const error = await captureError(zipped);
      expect(error).toBeInstanceOf(SkillParseError);
      expect((error as Error).message).toMatch(/file-count limit/);
    },
  );

  it('should still accept an entry declared exactly at the single-file limit', async () => {
    const zipped = declareOriginalSizes(
      zipSync({ 'SKILL.md': strToU8(skillMd), 'edge.bin': strToU8('x') }),
      { 'edge.bin': 64 * 1024 * 1024 },
    );

    const result = await parser.parseZipPackage(Buffer.from(zipped));
    expect(result.manifest.name).toBe('bomb');
    expect(result.resources.has('edge.bin')).toBe(true);
  });
});
