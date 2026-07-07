import { describe, expect, it } from 'vitest';

import { getShellConfig } from '../utils';

describe('getShellConfig', () => {
  it('should return shell config for current platform', () => {
    const config = getShellConfig('echo hello');

    if (process.platform === 'win32') {
      expect(config.cmd).toBe('cmd.exe');
      expect(config.args).toEqual(['/c', 'echo hello']);
    } else {
      expect(config.cmd).toBe('/bin/sh');
      expect(config.args).toEqual(['-c', 'echo hello']);
    }
  });
});
