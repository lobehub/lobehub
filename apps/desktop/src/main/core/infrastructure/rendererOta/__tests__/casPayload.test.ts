import { describe, expect, it } from 'vitest';

import { decodeCasPayload, encodeCasPayload, isGzipPayload } from '../casPayload';

describe('casPayload', () => {
  it('gzip-encodes CAS objects and decodes them back to the raw hash input', async () => {
    const raw = Buffer.from('export const x = 1;\n'.repeat(200));
    const encoded = await encodeCasPayload(raw);
    expect(isGzipPayload(encoded)).toBe(true);
    expect(encoded.byteLength).toBeLessThan(raw.byteLength);
    await expect(decodeCasPayload(encoded)).resolves.toEqual(raw);
  });

  it('leaves uncompressed payloads untouched so old CAS objects still apply', async () => {
    const raw = Buffer.from('not-gzip');
    await expect(decodeCasPayload(raw)).resolves.toEqual(raw);
  });
});
