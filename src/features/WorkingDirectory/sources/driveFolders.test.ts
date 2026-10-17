import { describe, expect, it } from 'vitest';

import {
  displayDrivePath,
  driveParentPath,
  environmentDirectoriesByPath,
  environmentDirectoryState,
  joinDrivePath,
} from './driveFolders';

const instance = (overrides: Record<string, unknown> = {}) => ({
  buildId: null,
  environmentId: 'env-1',
  id: 'inst-1',
  inUse: false,
  inUseByThisTopic: false,
  name: 'atlas',
  status: 'ready',
  workingDirectory: 'atlas',
  ...overrides,
});

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

describe('environmentDirectoryState', () => {
  it('reads a build in progress before anything else', () => {
    expect(environmentDirectoryState(instance({ inUse: true, status: 'pending' }))).toBe(
      'building',
    );
  });

  it("reads another conversation's run as in use, and this one's own as free", () => {
    expect(environmentDirectoryState(instance({ inUse: true }))).toBe('inUse');
    expect(environmentDirectoryState(instance({ inUse: true, inUseByThisTopic: true }))).toBe(
      'ready',
    );
  });

  it('reads a failed build as failed', () => {
    expect(environmentDirectoryState(instance({ status: 'error' }))).toBe('failed');
  });
});

describe('environmentDirectoriesByPath', () => {
  it('finds environment directories at the root only', () => {
    const rows = [instance()];

    expect(environmentDirectoriesByPath('', rows).get('atlas')?.id).toBe('inst-1');
    expect(environmentDirectoriesByPath('reports', rows).size).toBe(0);
  });
});
