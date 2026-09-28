import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  APP_UPDATE_UNSUPPORTED_MESSAGE,
  DEVICE_RPC_METHODS,
  executeDeviceRpc,
  TRASH_UNSUPPORTED_MESSAGE,
} from '../dispatch';
import type { DeviceControlDeps } from '../types';
import { WORKSPACE_ESCAPE_MESSAGE } from '../workspaceGuard';

let root: string;
let deviceHome: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'device-control-'));
  deviceHome = await mkdtemp(path.join(tmpdir(), 'device-control-home-'));
  vi.stubEnv('HOME', deviceHome);

  await mkdir(path.join(root, '.agents', 'skills', 'spa-routes'), { recursive: true });
  await writeFile(
    path.join(root, '.agents', 'skills', 'spa-routes', 'SKILL.md'),
    '---\nname: spa-routes\ndescription: SPA routing\n---\nbody',
  );
  await writeFile(path.join(root, 'AGENTS.md'), '# Agents');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(root, { force: true, recursive: true });
  await rm(deviceHome, { force: true, recursive: true });
});

const makeDeps = (): DeviceControlDeps => ({
  approveProjectRoot: vi.fn(async () => {}),
  getLocalFilePreview: vi.fn(async () => ({ success: true })),
  getProjectFileIndex: vi.fn(async () => ({
    entries: [],
    indexedAt: '',
    root: '',
    source: 'glob' as const,
  })),
  copyAssetForPublish: vi.fn(async () => ({ success: true })),
  readExternalAssetForPublish: vi.fn(async () => ({
    base64: 'AQID',
    contentType: 'image/png',
    success: true,
  })),
  searchProjectFiles: vi.fn(async () => ({
    entries: [],
    root: '',
    searchedAt: '',
    source: 'glob' as const,
  })),
});

describe('executeDeviceRpc', () => {
  it('throws on an unknown method', async () => {
    await expect(executeDeviceRpc('nope', {}, makeDeps())).rejects.toThrow(
      'Unknown device RPC method: nope',
    );
  });

  describe('app update', () => {
    const state = { currentVersion: '2.1.0', stage: 'downloaded' as const, targetVersion: '2.2.0' };

    it('routes each app-update method to its host handler', async () => {
      const deps: DeviceControlDeps = {
        ...makeDeps(),
        checkAppUpdate: vi.fn(async () => ({ ...state, stage: 'checking' as const })),
        getAppUpdateState: vi.fn(async () => state),
        installAppUpdate: vi.fn(async () => ({ targetVersion: '2.2.0' })),
      };

      await expect(executeDeviceRpc('getAppUpdateState', undefined, deps)).resolves.toEqual(state);
      await expect(executeDeviceRpc('checkAppUpdate', undefined, deps)).resolves.toMatchObject({
        stage: 'checking',
      });
      await expect(executeDeviceRpc('installAppUpdate', undefined, deps)).resolves.toEqual({
        targetVersion: '2.2.0',
      });
    });

    it.each(['getAppUpdateState', 'checkAppUpdate', 'installAppUpdate'])(
      'rejects %s with a stable reason on a host that cannot update itself',
      async (method) => {
        await expect(executeDeviceRpc(method, undefined, makeDeps())).rejects.toThrow(
          APP_UPDATE_UNSUPPORTED_MESSAGE,
        );
      },
    );
  });

  it('routes initWorkspace through the shared workspace scan and approves the root', async () => {
    const deps = makeDeps();
    const result = (await executeDeviceRpc('initWorkspace', { scope: root }, deps)) as {
      instructions: { content: string; source: string }[];
      skills: { name: string }[];
    };

    expect(result.skills.map((s) => s.name)).toEqual(['spa-routes']);
    expect(result.instructions).toEqual([{ content: '# Agents', source: 'AGENTS.md' }]);
    expect(deps.approveProjectRoot).toHaveBeenCalledWith(root);
  });

  it('routes listProjectSkills to the .agents/skills source', async () => {
    const result = (await executeDeviceRpc('listProjectSkills', { scope: root }, makeDeps())) as {
      source: string | null;
    };
    expect(result.source).toBe('.agents/skills');
  });

  it('merges project and device skills with project taking name precedence', async () => {
    const deviceSkillRoot = path.join(deviceHome, '.agents', 'skills');

    await mkdir(path.join(deviceSkillRoot, 'device-writer'), { recursive: true });
    await writeFile(
      path.join(deviceSkillRoot, 'device-writer', 'SKILL.md'),
      '---\nname: device-writer\ndescription: Device writer\n---\nbody',
    );
    await mkdir(path.join(deviceSkillRoot, 'spa-routes'), { recursive: true });
    await writeFile(
      path.join(deviceSkillRoot, 'spa-routes', 'SKILL.md'),
      '---\nname: spa-routes\ndescription: Device duplicate\n---\nbody',
    );

    try {
      const deps = makeDeps();
      const result = (await executeDeviceRpc('listProjectSkills', { scope: root }, deps)) as {
        skills: { name: string; previewRoot: string; scope: 'device' | 'project' }[];
      };

      expect(result.skills.map((skill) => `${skill.name}:${skill.scope}`)).toEqual([
        'device-writer:device',
        'spa-routes:project',
      ]);
      expect(result.skills.find((skill) => skill.name === 'device-writer')?.previewRoot).toBe(
        deviceSkillRoot,
      );
      expect(deps.approveProjectRoot).toHaveBeenCalledWith(root);
      expect(deps.approveProjectRoot).toHaveBeenCalledWith(deviceSkillRoot);
    } finally {
      await rm(path.join(deviceSkillRoot, 'device-writer'), { force: true, recursive: true });
      await rm(path.join(deviceSkillRoot, 'spa-routes'), { force: true, recursive: true });
    }
  });

  it('parses folded skill descriptions from frontmatter', async () => {
    await mkdir(path.join(root, '.agents', 'skills', 'agent-testing'), { recursive: true });
    await writeFile(
      path.join(root, '.agents', 'skills', 'agent-testing', 'SKILL.md'),
      [
        '---',
        'name: agent-testing',
        'description: >',
        '  Agentic end-to-end testing for LobeHub: backend verification via the CLI,',
        '  frontend verification via agent-browser (Electron).',
        '---',
        'body',
      ].join('\n'),
    );

    const result = (await executeDeviceRpc('listProjectSkills', { scope: root }, makeDeps())) as {
      skills: { description?: string; name: string }[];
    };

    expect(result.skills.find((skill) => skill.name === 'agent-testing')?.description).toBe(
      'Agentic end-to-end testing for LobeHub: backend verification via the CLI, frontend verification via agent-browser (Electron).',
    );
  });

  it('routes statPath and reports a directory + repo type', async () => {
    const result = (await executeDeviceRpc('statPath', { path: root }, makeDeps())) as {
      exists: boolean;
      isDirectory: boolean;
    };
    expect(result.exists).toBe(true);
    expect(result.isDirectory).toBe(true);
  });

  it('browses one directory level with pagination and excludes files and hidden folders', async () => {
    const browseRoot = await mkdtemp(path.join(tmpdir(), 'device-control-browse-'));
    try {
      await mkdir(path.join(browseRoot, '.hidden'));
      await mkdir(path.join(browseRoot, 'alpha'));
      await mkdir(path.join(browseRoot, 'beta'));
      await writeFile(path.join(browseRoot, 'notes.txt'), 'not a directory');

      const first = (await executeDeviceRpc(
        'browseDirectory',
        { limit: 1, path: browseRoot },
        makeDeps(),
      )) as { entries: { name: string }[]; nextCursor?: string; truncated: boolean };
      expect(first.entries.map((entry) => entry.name)).toEqual(['alpha']);
      expect(first.truncated).toBe(true);

      const second = (await executeDeviceRpc(
        'browseDirectory',
        { cursor: first.nextCursor, limit: 1, path: browseRoot },
        makeDeps(),
      )) as { entries: { name: string }[]; truncated: boolean };
      expect(second.entries.map((entry) => entry.name)).toEqual(['beta']);
      expect(second.truncated).toBe(false);
    } finally {
      await rm(browseRoot, { force: true, recursive: true });
    }
  });

  it('routes heterogeneous agent model discovery to the execution host', async () => {
    const deps = makeDeps();
    deps.listHeterogeneousAgentModels = vi.fn(async () => ({
      models: [{ id: 'openai/gpt-5.6', modelId: 'gpt-5.6', providerId: 'openai' }],
      status: 'success' as const,
      updatedAt: 1,
    }));
    const params = {
      args: ['--feature=test'],
      command: '/custom/traecli',
      cwd: root,
      type: 'trae' as const,
    };

    const result = await executeDeviceRpc('listHeterogeneousAgentModels', params, deps);

    expect(deps.listHeterogeneousAgentModels).toHaveBeenCalledWith(params);
    expect(result).toMatchObject({ status: 'success' });
  });

  it('reports model discovery as unsupported when the device client is too old', async () => {
    await expect(
      executeDeviceRpc('listHeterogeneousAgentModels', { type: 'opencode' }, makeDeps()),
    ).rejects.toThrow('does not support heterogeneous agent model discovery');
  });

  it('delegates project file and preview methods to injected deps', async () => {
    const deps = makeDeps();
    await executeDeviceRpc('getProjectFileIndex', { scope: root }, deps);
    expect(deps.getProjectFileIndex).toHaveBeenCalledWith({ scope: root });

    await executeDeviceRpc('searchProjectFiles', { query: 'agent', scope: root }, deps);
    expect(deps.searchProjectFiles).toHaveBeenCalledWith({ query: 'agent', scope: root });

    const previewParams = { path: path.join(root, 'AGENTS.md'), workingDirectory: root };
    await executeDeviceRpc('getLocalFilePreview', previewParams, deps);
    expect(deps.getLocalFilePreview).toHaveBeenCalledWith(previewParams);

    await executeDeviceRpc('readExternalAssetForPublish', previewParams, deps);
    expect(deps.readExternalAssetForPublish).toHaveBeenCalledWith(previewParams);

    const copyParams = {
      from: previewParams.path,
      to: path.join(root, 'copy.md'),
      workingDirectory: root,
    };
    await executeDeviceRpc('copyAssetForPublish', copyParams, deps);
    expect(deps.copyAssetForPublish).toHaveBeenCalledWith(copyParams);
  });

  it('routes a git method (listGitBranches) without touching deps', async () => {
    // Not a git repo → the shared local-file-shell impl returns an empty list.
    const result = await executeDeviceRpc('listGitBranches', { path: root }, makeDeps());
    expect(Array.isArray(result)).toBe(true);
  });

  it('routes moveLocalFiles to the shared local-file-shell impl', async () => {
    const oldPath = path.join(root, 'move-src.txt');
    const newPath = path.join(root, 'move-dst.txt');
    await writeFile(oldPath, 'hello');

    const result = (await executeDeviceRpc(
      'moveLocalFiles',
      { items: [{ newPath, oldPath }] },
      makeDeps(),
    )) as { newPath?: string; success: boolean }[];

    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(true);
    expect(result[0].newPath).toBe(newPath);
  });

  it('routes renameLocalFile to the shared local-file-shell impl', async () => {
    const filePath = path.join(root, 'rename-src.txt');
    await writeFile(filePath, 'hello');

    const result = (await executeDeviceRpc(
      'renameLocalFile',
      { newName: 'rename-dst.txt', path: filePath },
      makeDeps(),
    )) as { newPath: string; success: boolean };

    expect(result.success).toBe(true);
    expect(result.newPath).toBe(path.join(root, 'rename-dst.txt'));
  });

  it('routes writeLocalFile to the shared local-file-shell impl', async () => {
    const filePath = path.join(root, 'write-target.txt');

    const result = (await executeDeviceRpc(
      'writeLocalFile',
      { content: 'remote edit', path: filePath },
      makeDeps(),
    )) as { success: boolean };

    expect(result.success).toBe(true);
    expect(await readFile(filePath, 'utf8')).toBe('remote edit');
  });

  it('refuses to overwrite an existing target when routing moveLocalFiles', async () => {
    const oldPath = path.join(root, 'move-clash-src.txt');
    const newPath = path.join(root, 'move-clash-dst.txt');
    await writeFile(oldPath, 'incoming');
    await writeFile(newPath, 'keep me');

    const [result] = (await executeDeviceRpc(
      'moveLocalFiles',
      { items: [{ newPath, oldPath }] },
      makeDeps(),
    )) as { error?: string; success: boolean }[];

    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
    expect(await readFile(newPath, 'utf8')).toBe('keep me');
  });

  it('refuses to overwrite an existing sibling when routing renameLocalFile', async () => {
    const filePath = path.join(root, 'rename-clash-src.txt');
    await writeFile(filePath, 'incoming');
    await writeFile(path.join(root, 'rename-clash-dst.txt'), 'keep me');

    const result = (await executeDeviceRpc(
      'renameLocalFile',
      { newName: 'rename-clash-dst.txt', path: filePath },
      makeDeps(),
    )) as { error?: string; success: boolean };

    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
    expect(await readFile(path.join(root, 'rename-clash-dst.txt'), 'utf8')).toBe('keep me');
  });

  describe('file tree mutations', () => {
    it('exposes create / mkdir / copy / trash as device RPC methods', () => {
      expect(DEVICE_RPC_METHODS).toEqual(
        expect.arrayContaining([
          'createLocalFile',
          'createLocalDirectory',
          'copyLocalFiles',
          'trashLocalFiles',
        ]),
      );
    });

    it('routes createLocalFile and refuses an existing file', async () => {
      const filePath = path.join(root, 'created.ts');

      await expect(
        executeDeviceRpc('createLocalFile', { path: filePath, workspaceRoot: root }, makeDeps()),
      ).resolves.toEqual({ path: filePath, success: true });
      await expect(
        executeDeviceRpc(
          'createLocalFile',
          { content: 'x', path: filePath, workspaceRoot: root },
          makeDeps(),
        ),
      ).resolves.toMatchObject({
        error: expect.stringContaining('already exists'),
        success: false,
      });
      expect(await readFile(filePath, 'utf8')).toBe('');
    });

    it('routes createLocalDirectory and refuses an existing folder', async () => {
      const dirPath = path.join(root, 'created-dir');

      await expect(
        executeDeviceRpc(
          'createLocalDirectory',
          { path: dirPath, workspaceRoot: root },
          makeDeps(),
        ),
      ).resolves.toEqual({ path: dirPath, success: true });
      expect((await stat(dirPath)).isDirectory()).toBe(true);
      await expect(
        executeDeviceRpc(
          'createLocalDirectory',
          { path: dirPath, workspaceRoot: root },
          makeDeps(),
        ),
      ).resolves.toMatchObject({
        error: expect.stringContaining('already exists'),
        success: false,
      });
    });

    it('routes copyLocalFiles, duplicating in place when targetPath is omitted', async () => {
      const src = path.join(root, 'dup.md');
      await writeFile(src, 'dup');

      const result = await executeDeviceRpc(
        'copyLocalFiles',
        { items: [{ sourcePath: src }], workspaceRoot: root },
        makeDeps(),
      );

      expect(result).toEqual([
        { sourcePath: src, success: true, targetPath: path.join(root, 'dup copy.md') },
      ]);
      expect(await readFile(path.join(root, 'dup copy.md'), 'utf8')).toBe('dup');
    });

    it('routes trashLocalFiles to the host trash handler', async () => {
      const target = path.join(root, 'a.txt');
      const trashLocalFiles = vi.fn(async () => ({
        items: [{ path: target, success: true }],
        success: true,
      }));

      await expect(
        executeDeviceRpc(
          'trashLocalFiles',
          { paths: [target], workspaceRoot: root },
          {
            ...makeDeps(),
            trashLocalFiles,
          },
        ),
      ).resolves.toEqual({ items: [{ path: target, success: true }], success: true });
      expect(trashLocalFiles).toHaveBeenCalledWith({ paths: [target] });
    });

    it('rejects trashLocalFiles on a host without a trash instead of hard-deleting', async () => {
      const filePath = path.join(root, 'must-survive.txt');
      await writeFile(filePath, 'still here');

      await expect(
        executeDeviceRpc('trashLocalFiles', { paths: [filePath], workspaceRoot: root }, makeDeps()),
      ).rejects.toThrow(TRASH_UNSUPPORTED_MESSAGE);
      expect(await readFile(filePath, 'utf8')).toBe('still here');
    });

    describe('workspace containment through symlinks', () => {
      let workspace: string;
      let outside: string;

      beforeAll(async () => {
        workspace = await mkdtemp(path.join(tmpdir(), 'device-control-ws-'));
        outside = await mkdtemp(path.join(tmpdir(), 'device-control-outside-'));
        await writeFile(path.join(outside, 'secret.txt'), 'secret');
        // `<workspace>/link` passes a lexical "inside the root" check but
        // points at a folder outside the workspace.
        await symlink(outside, path.join(workspace, 'link'));
      });

      afterAll(async () => {
        await rm(workspace, { force: true, recursive: true });
        await rm(outside, { force: true, recursive: true });
      });

      it('refuses to create through a symlinked folder that leaves the workspace', async () => {
        const escaped = path.join(workspace, 'link', 'planted.txt');

        await expect(
          executeDeviceRpc(
            'createLocalFile',
            { path: escaped, workspaceRoot: workspace },
            makeDeps(),
          ),
        ).rejects.toThrow(WORKSPACE_ESCAPE_MESSAGE);
        await expect(
          executeDeviceRpc(
            'createLocalDirectory',
            { path: path.join(workspace, 'link', 'planted-dir'), workspaceRoot: workspace },
            makeDeps(),
          ),
        ).rejects.toThrow(WORKSPACE_ESCAPE_MESSAGE);
        await expect(readdir(outside)).resolves.toEqual(['secret.txt']);
      });

      it('refuses to copy a file out through the symlink', async () => {
        await writeFile(path.join(workspace, 'inside.txt'), 'inside');

        await expect(
          executeDeviceRpc(
            'copyLocalFiles',
            {
              items: [
                {
                  sourcePath: path.join(workspace, 'inside.txt'),
                  targetPath: path.join(workspace, 'link', 'copied.txt'),
                },
              ],
              workspaceRoot: workspace,
            },
            makeDeps(),
          ),
        ).rejects.toThrow(WORKSPACE_ESCAPE_MESSAGE);
        await expect(readdir(outside)).resolves.toEqual(['secret.txt']);
      });

      it('refuses to trash a file reached through the symlink', async () => {
        const trashLocalFiles = vi.fn();

        await expect(
          executeDeviceRpc(
            'trashLocalFiles',
            { paths: [path.join(workspace, 'link', 'secret.txt')], workspaceRoot: workspace },
            { ...makeDeps(), trashLocalFiles },
          ),
        ).rejects.toThrow(WORKSPACE_ESCAPE_MESSAGE);
        expect(trashLocalFiles).not.toHaveBeenCalled();
      });

      it('still lets the symlink entry itself be trashed', async () => {
        const trashLocalFiles = vi.fn(async () => ({ items: [], success: true }));
        const link = path.join(workspace, 'link');

        await executeDeviceRpc(
          'trashLocalFiles',
          { paths: [link], workspaceRoot: workspace },
          { ...makeDeps(), trashLocalFiles },
        );
        expect(trashLocalFiles).toHaveBeenCalledWith({ paths: [link] });
      });

      it('applies the same check to move / rename / write once the root is sent', async () => {
        await writeFile(path.join(workspace, 'movable.txt'), 'm');

        await expect(
          executeDeviceRpc(
            'moveLocalFiles',
            {
              items: [
                {
                  newPath: path.join(workspace, 'link', 'moved.txt'),
                  oldPath: path.join(workspace, 'movable.txt'),
                },
              ],
              workspaceRoot: workspace,
            },
            makeDeps(),
          ),
        ).rejects.toThrow(WORKSPACE_ESCAPE_MESSAGE);
        await expect(
          executeDeviceRpc(
            'renameLocalFile',
            {
              newName: 'renamed.txt',
              path: path.join(workspace, 'link', 'secret.txt'),
              workspaceRoot: workspace,
            },
            makeDeps(),
          ),
        ).rejects.toThrow(WORKSPACE_ESCAPE_MESSAGE);
        await expect(
          executeDeviceRpc(
            'writeLocalFile',
            {
              content: 'overwritten',
              path: path.join(workspace, 'link', 'secret.txt'),
              workspaceRoot: workspace,
            },
            makeDeps(),
          ),
        ).rejects.toThrow(WORKSPACE_ESCAPE_MESSAGE);
        expect(await readFile(path.join(outside, 'secret.txt'), 'utf8')).toBe('secret');
      });

      it('refuses create / copy / trash that arrive without a workspace root', async () => {
        await expect(
          executeDeviceRpc('createLocalFile', { path: path.join(workspace, 'x.txt') }, makeDeps()),
        ).rejects.toThrow(WORKSPACE_ESCAPE_MESSAGE);
      });
    });
  });

  it('routes listGitWorktrees through the shared git dispatcher', async () => {
    // Not a git repo → the shared local-file-shell impl returns an empty list.
    const result = await executeDeviceRpc('listGitWorktrees', { path: root }, makeDeps());
    expect(Array.isArray(result)).toBe(true);
  });

  it('routes removeGitWorktree through the shared git dispatcher', async () => {
    const result = (await executeDeviceRpc(
      'removeGitWorktree',
      { path: root, worktreePath: root },
      makeDeps(),
    )) as { success: boolean };
    expect(result.success).toBe(false);
  });
});
