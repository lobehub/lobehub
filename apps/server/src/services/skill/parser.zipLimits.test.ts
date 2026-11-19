import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { SkillParseError } from './errors';
import { SkillParser } from './parser';

// Regression tests for T-29: unzipBuffer used to decompress with no limits, so
// a tiny ZIP could declare huge entries and inflate into gigabytes inside a
// shared serverless process (zip bomb / memory DoS). fflate bounds each
// entry's output buffer by its declared `originalSize`, so the parser must
// reject oversized declarations before inflation starts.
describe('parseZipPackage unzip limits (T-29 regression)', () => {
  const parser = new SkillParser();
  const skillMd = '---\nname: bomb\ndescription: zip bomb\n---\ncontent';

  // Rejection is captured manually instead of `rejects.toThrow`: a resolved
  // ParsedZipSkill holds ~100 MiB of resource Buffers whose pretty-printed
  // assertion diff would OOM the test worker.
  const captureError = (zipped: Uint8Array) =>
    parser.parseZipPackage(Buffer.from(zipped)).catch((error: unknown) => error);

  it('should reject a single file over the extracted-size limit (high compression ratio)', async () => {
    // 65 MiB of zeros compresses to ~65 KiB — a classic zip-bomb shape.
    const zipped = zipSync({
      'SKILL.md': strToU8(skillMd),
      'payload.bin': new Uint8Array(65 * 1024 * 1024),
    });

    const error = await captureError(zipped);
    expect(error).toBeInstanceOf(SkillParseError);
    expect((error as Error).message).toMatch(/single-file limit/);
  });

  it('should reject when the cumulative extracted size exceeds the total limit', async () => {
    // Each file is under the single-file limit; together they exceed it.
    const zipped = zipSync({
      'SKILL.md': strToU8(skillMd),
      'a.bin': new Uint8Array(50 * 1024 * 1024),
      'b.bin': new Uint8Array(50 * 1024 * 1024),
      'c.bin': new Uint8Array(50 * 1024 * 1024),
    });

    const error = await captureError(zipped);
    expect(error).toBeInstanceOf(SkillParseError);
    expect((error as Error).message).toMatch(/total extracted size limit/);
  });

  it('should reject a ZIP with more entries than the file-count limit', async () => {
    const files: Record<string, Uint8Array> = { 'SKILL.md': strToU8(skillMd) };
    for (let i = 0; i < 50_000; i += 1) files[`f${i}.txt`] = strToU8('x');
    const zipped = zipSync(files);

    const error = await captureError(zipped);
    expect(error).toBeInstanceOf(SkillParseError);
    expect((error as Error).message).toMatch(/file-count limit/);
  });

  it('should still accept a file exactly at the single-file limit', async () => {
    const zipped = zipSync({
      'SKILL.md': strToU8(skillMd),
      'edge.bin': new Uint8Array(64 * 1024 * 1024),
    });

    const result = await parser.parseZipPackage(Buffer.from(zipped));
    expect(result.manifest.name).toBe('bomb');
    expect(result.resources.get('edge.bin')?.length).toBe(64 * 1024 * 1024);
  });
});
