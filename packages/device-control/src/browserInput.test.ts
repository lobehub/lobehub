import { describe, expect, it } from 'vitest';

import { browserEditCommandOf, parseBrowserKey, parseBrowserViewport } from './browserInput';

describe('parseBrowserKey', () => {
  it('passes plain keys and single characters through', () => {
    expect(parseBrowserKey('Enter', 'linux')).toEqual({
      combo: 'Enter',
      key: 'Enter',
      modifiers: [],
    });
    expect(parseBrowserKey('a', 'linux')).toEqual({ combo: 'a', key: 'a', modifiers: [] });
    expect(parseBrowserKey('中', 'linux').key).toBe('中');
  });

  it('normalizes key aliases and casing', () => {
    expect(parseBrowserKey('down', 'linux').key).toBe('ArrowDown');
    expect(parseBrowserKey('ESC', 'linux').key).toBe('Escape');
    expect(parseBrowserKey('Return', 'linux').key).toBe('Enter');
    expect(parseBrowserKey(' ', 'linux').key).toBe('Space');
    expect(parseBrowserKey('f5', 'linux').key).toBe('F5');
  });

  it('splits modifiers and orders them canonically', () => {
    expect(parseBrowserKey('shift+ctrl+ArrowDown', 'linux')).toEqual({
      combo: 'Control+Shift+ArrowDown',
      key: 'ArrowDown',
      modifiers: ['Control', 'Shift'],
    });
    expect(parseBrowserKey('Cmd + Option + i', 'darwin').combo).toBe('Alt+Meta+i');
  });

  it('upper-cases a shifted letter so it types as one', () => {
    expect(parseBrowserKey('Shift+h', 'linux').combo).toBe('Shift+H');
    expect(parseBrowserKey('Shift+Tab', 'linux').combo).toBe('Shift+Tab');
  });

  it('resolves ControlOrMeta per platform', () => {
    expect(parseBrowserKey('ControlOrMeta+a', 'darwin').combo).toBe('Meta+a');
    expect(parseBrowserKey('CmdOrCtrl+a', 'win32').combo).toBe('Control+a');
  });

  it('treats a trailing plus as the plus key', () => {
    expect(parseBrowserKey('+', 'linux').combo).toBe('+');
    expect(parseBrowserKey('Control++', 'linux')).toEqual({
      combo: 'Control++',
      key: '+',
      modifiers: ['Control'],
    });
  });

  it('rejects keys neither device would press', () => {
    expect(() => parseBrowserKey('', 'linux')).toThrow('key is required');
    expect(() => parseBrowserKey('Bogus', 'linux')).toThrow('Unsupported key "Bogus"');
    expect(() => parseBrowserKey('Hyper+a', 'linux')).toThrow('Unknown modifier "Hyper"');
    expect(() => parseBrowserKey('Control+', 'linux')).toThrow('Unsupported key');
    expect(() => parseBrowserKey('a+b', 'linux')).toThrow('Unknown modifier "a"');
  });
});

describe('browserEditCommandOf', () => {
  const command = (key: string, platform = 'darwin') =>
    browserEditCommandOf(parseBrowserKey(key, platform), platform);

  it('maps the macOS editing shortcuts', () => {
    expect(command('Meta+a')).toBe('selectAll');
    expect(command('Meta+C')).toBe('copy');
    expect(command('Meta+x')).toBe('cut');
    expect(command('Meta+v')).toBe('paste');
    expect(command('Meta+z')).toBe('undo');
    expect(command('Meta+Shift+z')).toBe('redo');
  });

  it('leaves other combos and other platforms to the key event', () => {
    expect(command('Meta+k')).toBeUndefined();
    expect(command('Meta+Shift+a')).toBeUndefined();
    expect(command('Control+a')).toBeUndefined();
    expect(command('Meta+Alt+a')).toBeUndefined();
    expect(command('Control+a', 'linux')).toBeUndefined();
  });
});

describe('parseBrowserViewport', () => {
  it('returns the size, or undefined to reset', () => {
    expect(parseBrowserViewport({ height: 900, width: 1440 })).toEqual({
      height: 900,
      width: 1440,
    });
    expect(parseBrowserViewport({})).toBeUndefined();
  });

  it('rejects a missing, fractional or out-of-range size', () => {
    expect(() => parseBrowserViewport({ width: 1440 })).toThrow('height must be');
    expect(() => parseBrowserViewport({ height: 900, width: 1440.5 })).toThrow('width must be');
    expect(() => parseBrowserViewport({ height: 900, width: 100 })).toThrow('between 320 and 3840');
  });
});
