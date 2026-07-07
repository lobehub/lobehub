import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { executeDeviceRpc } from '../dispatch';
import type { DeviceControlDeps } from '../types';

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

  it('delegates project file and preview methods to injected deps', async () => {
    const deps = makeDeps();
    await executeDeviceRpc('getProjectFileIndex', { scope: root }, deps);
    expect(deps.getProjectFileIndex).toHaveBeenCalledWith({ scope: root });

    await executeDeviceRpc('searchProjectFiles', { query: 'agent', scope: root }, deps);
    expect(deps.searchProjectFiles).toHaveBeenCalledWith({ query: 'agent', scope: root });

    const previewParams = { path: path.join(root, 'AGENTS.md'), workingDirectory: root };
    await executeDeviceRpc('getLocalFilePreview', previewParams, deps);
    expect(deps.getLocalFilePreview).toHaveBeenCalledWith(previewParams);
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
