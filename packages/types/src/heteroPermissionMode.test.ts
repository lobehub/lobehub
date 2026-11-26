import { describe, expect, it } from 'vitest';

import {
  applyHeteroPermissionModeDir,
  HETERO_PERMISSION_MODE_DIRS_LIMIT,
  isHeteroPermissionMode,
  readHeteroPermissionModeDir,
} from './heteroPermissionMode';

describe('heteroPermissionMode', () => {
  it('accepts only the offered modes', () => {
    expect(isHeteroPermissionMode('plan')).toBe(true);
    expect(isHeteroPermissionMode('dontAsk')).toBe(false);
    expect(isHeteroPermissionMode(undefined)).toBe(false);
  });

  it('reads the remembered mode, defaulting to bypass', () => {
    const dirs = [{ key: 'd::/a', mode: 'plan' as const }];
    expect(readHeteroPermissionModeDir(dirs, 'd::/a')).toBe('plan');
    expect(readHeteroPermissionModeDir(dirs, 'd::/b')).toBe('bypassPermissions');
    expect(readHeteroPermissionModeDir(undefined, 'd::/a')).toBe('bypassPermissions');
  });

  it('moves the latest pick to the front and drops the default', () => {
    const start = [
      { key: 'd::/a', mode: 'plan' as const },
      { key: 'd::/b', mode: 'default' as const },
    ];
    expect(applyHeteroPermissionModeDir(start, 'd::/b', 'acceptEdits')).toEqual([
      { key: 'd::/b', mode: 'acceptEdits' },
      { key: 'd::/a', mode: 'plan' },
    ]);
    expect(applyHeteroPermissionModeDir(start, 'd::/a', 'bypassPermissions')).toEqual([
      { key: 'd::/b', mode: 'default' },
    ]);
  });

  it('caps the list, evicting the least recently set', () => {
    const full = Array.from({ length: HETERO_PERMISSION_MODE_DIRS_LIMIT }, (_, i) => ({
      key: `d::/${i}`,
      mode: 'plan' as const,
    }));
    const next = applyHeteroPermissionModeDir(full, 'd::/new', 'auto');
    expect(next).toHaveLength(HETERO_PERMISSION_MODE_DIRS_LIMIT);
    expect(next[0]).toEqual({ key: 'd::/new', mode: 'auto' });
    expect(next.at(-1)?.key).toBe(`d::/${HETERO_PERMISSION_MODE_DIRS_LIMIT - 2}`);
  });
});
