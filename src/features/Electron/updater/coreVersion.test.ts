import { describe, expect, it } from 'vitest';

import { formatCoreVersion } from './coreVersion';

describe('formatCoreVersion', () => {
  it('hides the core pack segment of an OTA version', () => {
    expect(formatCoreVersion('2.2.19-canary.33-core.2')).toBe('2.2.19-canary.33-2');
  });

  it('keeps versions that carry no core segment untouched', () => {
    expect(formatCoreVersion('2.2.19-canary.33-2')).toBe('2.2.19-canary.33-2');
    expect(formatCoreVersion('2.2.19')).toBe('2.2.19');
  });
});
