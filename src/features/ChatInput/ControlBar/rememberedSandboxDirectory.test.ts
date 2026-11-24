import { afterEach, describe, expect, it } from 'vitest';

import {
  getRememberedSandboxDirectory,
  rememberedSandboxDirectoryKey,
  rememberSandboxSelection,
} from './rememberedSandboxDirectory';

const ME = { userId: 'user-a' };
const MY_WS = { userId: 'user-a', workspaceId: 'ws_1' };

afterEach(() => {
  localStorage.clear();
});

describe('rememberedSandboxDirectory', () => {
  it('remembers a folder picked on the drive', () => {
    rememberSandboxSelection(ME, 'agent-1', { workingDirectory: 'projects/demo' });

    expect(getRememberedSandboxDirectory(ME, 'agent-1')).toEqual({
      workingDirectory: 'projects/demo',
    });
  });

  it('keeps the drive of a workspace pick', () => {
    rememberSandboxSelection(MY_WS, 'agent-1', { drive: 'public', workingDirectory: 'team' });

    expect(getRememberedSandboxDirectory(MY_WS, 'agent-1')).toEqual({
      drive: 'public',
      workingDirectory: 'team',
    });
  });

  it('keeps each workspace and agent apart', () => {
    rememberSandboxSelection(ME, 'agent-1', { workingDirectory: 'mine' });

    expect(getRememberedSandboxDirectory(MY_WS, 'agent-1')).toBeUndefined();
    expect(getRememberedSandboxDirectory(ME, 'agent-2')).toBeUndefined();
  });

  // Storage outlives a logout; the next member on the same browser shares the
  // workspace and the agent but not the first member's personal folders.
  it("never hands one member's folder to another on the same browser", () => {
    rememberSandboxSelection(MY_WS, 'agent-1', { drive: 'personal', workingDirectory: 'mine' });

    expect(
      getRememberedSandboxDirectory({ userId: 'user-b', workspaceId: 'ws_1' }, 'agent-1'),
    ).toBeUndefined();
  });

  it('reads and writes nothing before the user is known', () => {
    rememberSandboxSelection({ workspaceId: 'ws_1' }, 'agent-1', { workingDirectory: 'x' });

    expect(localStorage.length).toBe(0);
    expect(getRememberedSandboxDirectory({ workspaceId: 'ws_1' }, 'agent-1')).toBeUndefined();
  });

  // T-14825: the cloud sandbox is not set up from an environment, so only the
  // folder is remembered; picking a temporary sandbox leaves it alone.
  it('remembers the folder alone, whatever environment the pick carried', () => {
    rememberSandboxSelection(ME, 'agent-1', { environmentId: 'env_1', workingDirectory: 'code' });
    rememberSandboxSelection(ME, 'agent-1', { environmentId: 'env_1' });

    const key = rememberedSandboxDirectoryKey(ME, 'agent-1')!;
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ workingDirectory: 'code' });
    expect(localStorage.length).toBe(1);
  });

  it('changes nothing for a legacy environment directory', () => {
    rememberSandboxSelection(ME, 'agent-1', { workingDirectory: 'code' });
    rememberSandboxSelection(ME, 'agent-1', { instanceId: 'inst_1' });

    expect(getRememberedSandboxDirectory(ME, 'agent-1')).toEqual({ workingDirectory: 'code' });
  });

  it('ignores a corrupted entry', () => {
    const key = rememberedSandboxDirectoryKey(ME, 'agent-1')!;
    localStorage.setItem(key, '{not json');
    expect(getRememberedSandboxDirectory(ME, 'agent-1')).toBeUndefined();

    localStorage.setItem(key, JSON.stringify({ drive: 'other', workingDirectory: 'x' }));
    expect(getRememberedSandboxDirectory(ME, 'agent-1')).toBeUndefined();
  });
});
