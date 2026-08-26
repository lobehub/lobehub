import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { decodeCasPayload } from '../casPayload';

describe('casPayload', () => {
  it('decodes gzip CAS objects back to the raw hash input', async () => {
    const raw = Buffer.from('export const x = 1;\n'.repeat(200));
    const encoded = gzipSync(raw, { level: 9 });
    expect(encoded.byteLength).toBeLessThan(raw.byteLength);
    await expect(decodeCasPayload(encoded)).resolves.toEqual(raw);
  });

  it('leaves uncompressed payloads untouched so old CAS objects still apply', async () => {
    const raw = Buffer.from('not-gzip');
    await expect(decodeCasPayload(raw)).resolves.toEqual(raw);
  });
});
