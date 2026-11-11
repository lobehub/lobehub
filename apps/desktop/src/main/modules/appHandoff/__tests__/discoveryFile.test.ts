import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  channelFromScheme,
  getDiscoveryFile,
  removeDiscoveryFile,
  removeDiscoveryFileSync,
  writeDiscoveryFile,
} from '../discoveryFile';

describe('discovery file', () => {
  it('maps the deep link scheme to a channel', () => {
    expect(channelFromScheme('lobehub')).toBe('stable');
    expect(channelFromScheme('lobehub-beta')).toBe('beta');
    expect(channelFromScheme('lobehub-nightly')).toBe('nightly');
    expect(channelFromScheme('lobehub-dev')).toBe('dev');
  });

  it('publishes port, pid and issuer only, readable by this user only', async () => {
    const dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'handoff-')), 'desktop-handoff');
    const file = await writeDiscoveryFile(
      { channel: 'stable', issuer: 'https://app.lobehub.com/oidc', pid: 4321, port: 51234 },
      dir,
    );

    expect(file).toBe(getDiscoveryFile('stable', dir));
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      channel: 'stable',
      issuer: 'https://app.lobehub.com/oidc',
      pid: 4321,
      port: 51234,
      v: 1,
    });
    if (process.platform !== 'win32') {
      expect((await stat(dir)).mode & 0o777).toBe(0o700);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    }
  });

  it('removes the file only while it belongs to this process', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'handoff-'));
    await writeDiscoveryFile({ channel: 'beta', issuer: 'x', pid: 1111, port: 1 }, dir);

    await expect(removeDiscoveryFile('beta', dir, 2222)).resolves.toBe(false);
    await expect(readFile(getDiscoveryFile('beta', dir), 'utf8')).resolves.toContain('1111');
    await expect(removeDiscoveryFile('beta', dir, 1111)).resolves.toBe(true);
    await expect(readFile(getDiscoveryFile('beta', dir), 'utf8')).rejects.toThrow();
  });

  it('removes the file synchronously for quit, only while it belongs to this process', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'handoff-'));
    await writeDiscoveryFile({ channel: 'stable', issuer: 'x', pid: 1111, port: 1 }, dir);

    expect(removeDiscoveryFileSync('stable', dir, 2222)).toBe(false);
    expect(removeDiscoveryFileSync('stable', dir, 1111)).toBe(true);
    await expect(readFile(getDiscoveryFile('stable', dir), 'utf8')).rejects.toThrow();
  });
});
