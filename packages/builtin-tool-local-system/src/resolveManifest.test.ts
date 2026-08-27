import { describe, expect, it } from 'vitest';

import { READ_FILE_DESCRIPTION } from './manifest';
import { resolveLocalSystemManifest } from './resolveManifest';
import { LocalSystemApiName } from './types';

const readFileDescription = (executionEnv: 'device' | 'local') =>
  resolveLocalSystemManifest({ executionEnv })?.api.find(
    (api) => api.name === LocalSystemApiName.readFile,
  )?.description;

describe('resolveLocalSystemManifest', () => {
  it('advertises direct image reads for the desktop local runtime', () => {
    const manifest = resolveLocalSystemManifest({ executionEnv: 'local' });

    expect(readFileDescription('local')).toContain('PNG');
    expect(readFileDescription('local')).toContain('base64');
    expect(manifest?.systemRole).toContain('Image files are uploaded as visual tool results');
  });

  it('keeps device instructions aligned with local-file-shell capabilities', () => {
    const manifest = resolveLocalSystemManifest({ executionEnv: 'device' });

    expect(readFileDescription('device')).toBe(READ_FILE_DESCRIPTION);
    expect(manifest?.systemRole).not.toContain('base64');
    expect(manifest?.systemRole).not.toContain('local images such as PNG');
  });
});
