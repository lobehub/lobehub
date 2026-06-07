import { describe, expect, it } from 'vitest';

import { getShellConfig, MAX_OUTPUT_LENGTH, truncateOutput } from '../utils';

describe('truncateOutput', () => {
  it('should return string as-is when within limit', () => {
    expect(truncateOutput('short', 100)).toBe('short');
  });

  it('should truncate long string with indicator', () => {
    const long = 'x'.repeat(200);
    const result = truncateOutput(long, 100);

    expect(result.length).toBeLessThan(200);
    expect(result).toContain('truncated');
    expect(result).toContain('more characters');
  });

  it('should preserve ANSI escape codes so the client can render colors', () => {
    const colored = '\x1B[31m' + 'x'.repeat(50) + '\x1B[0m';
    const result = truncateOutput(colored, 100);
    expect(result).toBe(colored);
    expect(result).toContain('\x1B[');
  });

  it('should use MAX_OUTPUT_LENGTH as default', () => {
    const long = 'x'.repeat(MAX_OUTPUT_LENGTH + 1000);
    const result = truncateOutput(long);
    expect(result).toContain('truncated');
    expect(result.length).toBeLessThan(long.length);
  });
});

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
