import { describe, expect, it } from 'vitest';

import { resolveLogLevel } from './layout';

describe('resolveLogLevel', () => {
  it('keeps debug records out of packaged builds unless the user enables them', () => {
    expect(resolveLogLevel({ debugLogging: false, isPackaged: true })).toBe('info');
    expect(resolveLogLevel({ debugLogging: true, isPackaged: true })).toBe('debug');
  });

  it('records every level in dev regardless of the setting', () => {
    expect(resolveLogLevel({ debugLogging: false, isPackaged: false })).toBe('debug');
  });
});
