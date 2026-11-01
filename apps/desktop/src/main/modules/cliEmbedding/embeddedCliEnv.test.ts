import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { withEmbeddedCliEnv } from './embeddedCliEnv';

vi.mock('electron', () => ({ app: { getPath: () => '/userData' } }));

const wrapperDir = path.join('/userData', 'bin');
const pathOf = (...dirs: string[]) => dirs.join(path.delimiter);

describe('withEmbeddedCliEnv', () => {
  it('puts the bundled CLI ahead of an older global lh', () => {
    // The app appends its wrapper dir, so a pnpm-global `lh` without `goal` won.
    const env = withEmbeddedCliEnv({ PATH: pathOf('/pnpm', '/usr/bin', wrapperDir) });

    expect(env.PATH).toBe(pathOf(wrapperDir, '/pnpm', '/usr/bin'));
  });

  it('names the bundled wrapper for shells whose profile reorders PATH', () => {
    const env = withEmbeddedCliEnv({ HOME: '/home/u', PATH: '/usr/bin' });

    expect(env.LOBEHUB_CLI).toBe(
      path.join(wrapperDir, process.platform === 'win32' ? 'lh.cmd' : 'lh'),
    );
    expect(env.HOME).toBe('/home/u');
  });

  it('works when the env carries no PATH', () => {
    expect(withEmbeddedCliEnv({}).PATH).toBe(wrapperDir);
  });

  it('prefixes the Windows `Path` key instead of adding a wrapper-only PATH', () => {
    // process.env spells it `Path` on Windows; a second `PATH` holding only the
    // wrapper dir made the child drop System32 and every inherited directory.
    const env = withEmbeddedCliEnv(
      { Path: 'C:\\Windows\\System32;C:\\Git\\cmd' },
      'C:\\lh\\bin',
      'win32',
    );

    expect(env.Path).toBe('C:\\lh\\bin;C:\\Windows\\System32;C:\\Git\\cmd');
    expect(env).not.toHaveProperty('PATH');
  });

  it('on Windows, prefers an explicit PATH and drops other spellings', () => {
    const env = withEmbeddedCliEnv(
      { PATH: 'C:\\login\\bin', Path: 'C:\\Windows' },
      'C:\\lh\\bin',
      'win32',
    );

    expect(env.PATH).toBe('C:\\lh\\bin;C:\\login\\bin');
    expect(env).not.toHaveProperty('Path');
  });

  it('keeps differently-cased names apart on case-sensitive platforms', () => {
    const env = withEmbeddedCliEnv({ PATH: '/usr/bin', Path: 'other' }, '/lh/bin', 'darwin');

    expect(env.PATH).toBe('/lh/bin:/usr/bin');
    expect(env.Path).toBe('other');
  });
});
