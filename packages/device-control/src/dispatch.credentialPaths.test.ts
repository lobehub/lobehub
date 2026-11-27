import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AGENT_CREDENTIAL_ACCESS_DENIED_MESSAGE,
  isPathInsideAgentCredentialRoot,
} from './agentCredentials/pathGuard';
import { executeDeviceRpc } from './dispatch';
import type { DeviceControlDeps } from './types';

let home: string;
let rootDir: string;
let credentialFile: string;
let workspace: string;

const makeDeps = (overrides: Partial<DeviceControlDeps> = {}): DeviceControlDeps => ({
  agentCredentialRootDir: rootDir,
  getLocalFilePreview: vi.fn(async () => ({ success: true })),
  getProjectFileIndex: vi.fn(),
  readExternalAssetForPublish: vi.fn(async () => ({ success: true })),
  searchProjectFiles: vi.fn(),
  trashLocalFiles: vi.fn(async () => ({ items: [], success: true })),
  ...overrides,
});

const denied = (method: string, params: unknown, deps = makeDeps()) =>
  expect(executeDeviceRpc(method, params, deps)).rejects.toThrow(
    AGENT_CREDENTIAL_ACCESS_DENIED_MESSAGE,
  );

beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'lh-cred-guard-'));
  rootDir = path.join(home, '.lobehub', 'agent-credentials');
  credentialFile = path.join(rootDir, 'claude-code', 'credential.json');
  workspace = path.join(home, 'project');
  await mkdir(path.dirname(credentialFile), { recursive: true });
  await writeFile(credentialFile, '{"token":"secret"}');
  await mkdir(workspace, { recursive: true });
});

afterEach(async () => {
  await rm(home, { force: true, recursive: true });
});

describe('file RPCs and the agent-credential store', () => {
  it('refuses to preview a credential file by its direct path', async () => {
    const deps = makeDeps();
    await denied(
      'getLocalFilePreview',
      { path: credentialFile, workingDirectory: workspace },
      deps,
    );
    expect(deps.getLocalFilePreview).not.toHaveBeenCalled();
  });

  it('refuses a `..` traversal relative to the working directory', async () => {
    await denied('getLocalFilePreview', {
      path: '../.lobehub/agent-credentials/claude-code/credential.json',
      workingDirectory: workspace,
    });
    await denied('readExternalAssetForPublish', {
      path: `${workspace}/../.lobehub/agent-credentials/claude-code/credential.json`,
      workingDirectory: workspace,
    });
  });

  it.skipIf(process.platform === 'win32')(
    'refuses a symlink that points into the store',
    async () => {
      const fileLink = path.join(workspace, 'innocent.json');
      const dirLink = path.join(workspace, 'linked-dir');
      await symlink(credentialFile, fileLink);
      await symlink(path.join(rootDir, 'claude-code'), dirLink);

      await denied('getLocalFilePreview', { path: fileLink, workingDirectory: workspace });
      await denied('browseDirectory', { path: dirLink });
      // A file that does not exist yet, under a linked parent, is caught too.
      await denied('writeLocalFile', {
        content: 'x',
        path: path.join(dirLink, 'new.json'),
      });
    },
  );

  it('refuses to browse, list or stat inside the store', async () => {
    await denied('browseDirectory', { path: rootDir });
    await denied('browseDirectory', { path: path.join(rootDir, 'claude-code') });
    await denied('statPath', { path: credentialFile });
    await denied('listProjectDirectory', { relativePath: 'claude-code', root: rootDir });
    await denied('listProjectDirectory', {
      relativePath: '.lobehub/agent-credentials',
      root: home,
    });
    await denied('getProjectFileIndex', { scope: rootDir });
    await denied('searchProjectFiles', { query: 'credential', scope: rootDir });
  });

  it('refuses writes, moves, copies and trash that touch the store', async () => {
    await denied('writeLocalFile', { content: '{}', path: credentialFile });
    await denied('createLocalFile', {
      path: path.join(rootDir, 'x'),
      workspaceRoot: home,
    });
    await denied('moveLocalFiles', {
      items: [{ newPath: path.join(workspace, 'stolen.json'), oldPath: credentialFile }],
    });
    await denied('renameLocalFile', { newName: 'x.json', path: credentialFile });
    await denied('copyLocalFiles', {
      items: [{ sourcePath: credentialFile, targetPath: path.join(workspace, 'copy.json') }],
      workspaceRoot: home,
    });
    await denied('copyAssetForPublish', {
      from: credentialFile,
      to: path.join(workspace, 'a.json'),
      workingDirectory: workspace,
    });
    await denied('trashLocalFiles', { paths: [credentialFile], workspaceRoot: home });

    expect(await readFile(credentialFile, 'utf8')).toBe('{"token":"secret"}');
  });

  it('expands `~` the way the file handlers do before judging the path', async () => {
    const homedir = vi.spyOn(os, 'homedir').mockReturnValue(home);
    try {
      await denied('getLocalFilePreview', {
        path: '~/.lobehub/agent-credentials/claude-code/credential.json',
        workingDirectory: home,
      });
      await denied('copyLocalFiles', {
        items: [{ sourcePath: '~', targetPath: path.join(workspace, 'copy') }],
        workspaceRoot: home,
      });
    } finally {
      homedir.mockRestore();
    }
  });

  it('refuses moving, copying or trashing a folder that contains the store', async () => {
    const lobehubDir = path.join(home, '.lobehub');
    await denied('copyLocalFiles', {
      items: [{ sourcePath: lobehubDir, targetPath: path.join(workspace, 'copy') }],
      workspaceRoot: home,
    });
    await denied('moveLocalFiles', {
      items: [{ newPath: path.join(workspace, 'moved'), oldPath: home }],
    });
    await denied('renameLocalFile', { newName: 'renamed', path: lobehubDir });
    await denied('trashLocalFiles', { paths: [lobehubDir], workspaceRoot: home });

    // Reading or listing the parent is not an operation on the whole tree.
    expect(await isPathInsideAgentCredentialRoot(lobehubDir, rootDir)).toBe(false);
    expect(await readFile(credentialFile, 'utf8')).toBe('{"token":"secret"}');
  });

  it('still serves paths outside the store, including its parent', async () => {
    const deps = makeDeps();
    const target = path.join(workspace, 'notes.md');

    await expect(
      executeDeviceRpc('getLocalFilePreview', { path: target, workingDirectory: workspace }, deps),
    ).resolves.toEqual({ success: true });
    // A sibling whose name only starts with the store's name is not inside it.
    expect(
      await isPathInsideAgentCredentialRoot(`${rootDir}-backup/credential.json`, rootDir),
    ).toBe(false);
    // Listing the parent may show the folder name; only entering it is refused.
    await expect(
      executeDeviceRpc('browseDirectory', { path: path.join(home, '.lobehub') }, deps),
    ).resolves.toMatchObject({ entries: [expect.objectContaining({ name: 'agent-credentials' })] });
  });

  it('error never names the path', async () => {
    const error = await executeDeviceRpc(
      'getLocalFilePreview',
      { path: credentialFile, workingDirectory: workspace },
      makeDeps(),
    ).catch((e: Error) => e);

    expect((error as Error).message).toBe(AGENT_CREDENTIAL_ACCESS_DENIED_MESSAGE);
  });
});
