import { describe, expect, it } from 'vitest';

import { getShellConfig, MAX_OUTPUT_LENGTH, stripAnsi, truncateOutput } from '../utils';

describe('stripAnsi', () => {
  it('should strip ANSI color codes', () => {
    expect(stripAnsi('\x1B[31mred\x1B[0m')).toBe('red');
  });

  it('should strip complex ANSI sequences', () => {
    expect(stripAnsi('\x1B[38;5;250m███████╗\x1B[0m')).toBe('███████╗');
  });

  it('should strip bold/bright codes', () => {
    expect(stripAnsi('\x1B[1;32mSuccess\x1B[0m')).toBe('Success');
  });

  it('should handle string without ANSI codes', () => {
    expect(stripAnsi('plain text')).toBe('plain text');
  });

  it('should handle empty string', () => {
    expect(stripAnsi('')).toBe('');
  });

  it('should strip multiple ANSI sequences', () => {
    const input = '\x1B[33mwarning:\x1B[0m something \x1B[31mhappened\x1B[0m';
    expect(input).toContain('\x1B[');
    expect(stripAnsi(input)).toBe('warning: something happened');
    expect(stripAnsi(input)).not.toContain('\x1B[');
  });
});

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

  it('should strip ANSI before checking length', () => {
    const colored = '\x1B[31m' + 'x'.repeat(50) + '\x1B[0m';
    const result = truncateOutput(colored, 100);
    expect(result).toBe('x'.repeat(50));
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
