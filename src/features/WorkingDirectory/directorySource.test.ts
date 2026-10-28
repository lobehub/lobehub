import { describe, expect, it } from 'vitest';

import { displayedDirectoryPath } from './directorySource';

const drivePath = (path: string) => `/${path}`;

describe('displayedDirectoryPath', () => {
  it("shows a drive's top level as / when its listing failed, not an empty field", () => {
    expect(displayedDirectoryPath({ displayPath: drivePath })).toBe('/');
    expect(displayedDirectoryPath({ displayPath: drivePath, requestedPath: 'reports' })).toBe(
      '/reports',
    );
  });

  it('shows the listed folder, and what is being typed over it', () => {
    expect(displayedDirectoryPath({ directoryPath: 'a/b', displayPath: drivePath })).toBe('/a/b');
    expect(
      displayedDirectoryPath({ directoryPath: 'a', displayPath: drivePath, draft: '/a/c' }),
    ).toBe('/a/c');
  });

  it('leaves a device path as it is, and empty while its home is unknown', () => {
    expect(displayedDirectoryPath({ directoryPath: '/Users/me' })).toBe('/Users/me');
    expect(displayedDirectoryPath({})).toBe('');
  });
});
