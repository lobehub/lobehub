import { readFile, realpath } from 'node:fs/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCliInstallationPath, getConnectorInstallationPath } from './installation';

vi.mock('node:fs/promises', () => ({ readFile: vi.fn(), realpath: vi.fn(async (value) => value) }));
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('installation paths', () => {
  it('resolves the invoked entry to its canonical installation', async () => {
    vi.mocked(realpath).mockResolvedValueOnce('/opt/npm/@lobehub/cli/dist/index.js');
    expect(await getCliInstallationPath()).toBe('/opt/npm/@lobehub/cli/dist/index.js');
  });

  it('uses the connector report without reading its arguments', async () => {
    expect(await getConnectorInstallationPath(42, '/opt/cli/dist/index.js')).toBe(
      '/opt/cli/dist/index.js',
    );
    expect(readFile).not.toHaveBeenCalled();
  });

  it('extracts only the entry path of a legacy Linux connector', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    vi.mocked(readFile).mockResolvedValue(
      '/usr/bin/node\0/opt/cli/dist/index.js\0connect\0--token\0secret\0',
    );
    expect(await getConnectorInstallationPath(42)).toBe('/opt/cli/dist/index.js');
    expect(readFile).toHaveBeenCalledWith('/proc/42/cmdline', 'utf8');
  });

  it.each([
    '/bin/sh\0-c\0secret\0',
    '/usr/bin/node\0--token\0secret\0',
    '/usr/bin/node\0secret\0connect\0',
    '/usr/bin/node\0/opt/cli/index.js\0other-command\0',
  ])('does not guess an entry from an unsupported argv shape', async (argv) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    vi.mocked(readFile).mockResolvedValue(argv);
    expect(await getConnectorInstallationPath(42)).toBeUndefined();
  });

  it('does not fabricate a path when proc is inaccessible', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    vi.mocked(readFile).mockRejectedValueOnce(new Error('permission denied'));
    expect(await getConnectorInstallationPath(42)).toBeUndefined();
  });

  it('keeps a valid path for a removed installation', async () => {
    vi.mocked(realpath).mockRejectedValueOnce(new Error('missing'));
    expect(await getConnectorInstallationPath(42, '/opt/old/index.js')).toBe('/opt/old/index.js');
  });

  it.each(['relative.js', '/opt/path\nWARN: false message', '/opt/path\0secret'])(
    'rejects invalid reported paths',
    async (entry) => {
      expect(await getConnectorInstallationPath(42, entry)).toBeUndefined();
    },
  );
});
