import { describe, expect, it } from 'vitest';

import { displayDrivePath, driveParentPath, joinDrivePath } from './driveFolders';

describe('drive paths', () => {
  it('walks up to the root and stops there', () => {
    expect(driveParentPath('a/b/c')).toBe('a/b');
    expect(driveParentPath('a')).toBe('');
    expect(driveParentPath('')).toBeNull();
  });

  it('joins at the root without a leading slash', () => {
    expect(joinDrivePath('', 'reports')).toBe('reports');
    expect(joinDrivePath('reports', 'q3')).toBe('reports/q3');
  });

  it('shows paths rooted at the drive', () => {
    expect(displayDrivePath('')).toBe('/');
    expect(displayDrivePath('reports/q3')).toBe('/reports/q3');
  });
});
