import { describe, expect, it } from 'vitest';

import {
  IMAGE_CAPABLE_READ_FILE_DESCRIPTION,
  LocalSystemManifest,
  READ_FILE_DESCRIPTION,
} from './manifest';
import { resolveLocalSystemManifest } from './resolveManifest';
import { LocalSystemApiName } from './types';

const readFileDescription = (
  executionEnv?: 'device' | 'device-unrouted' | 'local' | 'none' | 'sandbox',
) =>
  resolveLocalSystemManifest({ executionEnv })?.api.find(
    (api) => api.name === LocalSystemApiName.readFile,
  )?.description;

describe('resolveLocalSystemManifest', () => {
  it('keeps the context-free manifest limited to portable file capabilities', () => {
    const description = LocalSystemManifest.api.find(
      (api) => api.name === LocalSystemApiName.readFile,
    )?.description;

    expect(description).toBe(READ_FILE_DESCRIPTION);
    expect(description).not.toContain('PNG');
  });

  it('advertises direct image reads for the desktop local runtime', () => {
    const manifest = resolveLocalSystemManifest({ executionEnv: 'local' });

    expect(readFileDescription('local')).toBe(IMAGE_CAPABLE_READ_FILE_DESCRIPTION);
    expect(readFileDescription('local')).toContain('base64');
    expect(manifest?.systemRole).toContain('Image files are uploaded as visual tool results');
  });

  it.each([undefined, 'device', 'device-unrouted', 'none', 'sandbox'] as const)(
    'keeps %s instructions aligned with portable file capabilities',
    (executionEnv) => {
      const manifest = resolveLocalSystemManifest({ executionEnv });

      expect(readFileDescription(executionEnv)).toBe(READ_FILE_DESCRIPTION);
      expect(manifest?.systemRole).not.toContain('base64');
      expect(manifest?.systemRole).not.toContain('local images such as PNG');
    },
  );
});
