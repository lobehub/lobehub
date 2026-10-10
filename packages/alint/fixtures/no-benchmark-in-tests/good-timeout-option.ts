// Fixture carve-out: a millisecond field from production code, not a measured duration.
import { describe, expect, it } from 'vitest';

import { resolveUploadOptions } from '../remoteFileUpload';

describe('resolveUploadOptions', () => {
  it('keeps the upload timeout under the gateway limit', () => {
    const options = resolveUploadOptions({ size: 1024 });

    expect(options.timeout).toBeLessThan(30_000);
    expect(options.retries).toBe(2);
  });
});
