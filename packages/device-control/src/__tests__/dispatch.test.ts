import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { executeDeviceRpc } from '../dispatch';
import type { DeviceControlDeps } from '../types';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'device-control-'));
  await mkdir(path.join(root, '.agents', 'skills', 'spa-routes'), { recursive: true });
  await writeFile(
    path.join(root, '.agents', 'skills', 'spa-routes', 'SKILL.md'),
    '---\nname: spa-routes\ndescription: SPA routing\n---\nbody',
  );
  await writeFile(path.join(root, 'AGENTS.md'), '# Agents');
});

afterAll(async () => {
  await rm(root, { force: true, recursive: true });
});

const makeDeps = (): DeviceControlDeps => ({
  approveProjectRoot: vi.fn(async () => {}),
  getLocalFilePreview: vi.fn(async () => ({ success: true })),
  getProjectFileIndex: vi.fn(async () => ({
    entries: [],
    indexedAt: '',
    root: '',
    source: 'glob' as const,
    totalCount: 0,
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

  it('routes statPath and reports a directory + repo type', async () => {
    const result = (await executeDeviceRpc('statPath', { path: root }, makeDeps())) as {
      exists: boolean;
      isDirectory: boolean;
    };
    expect(result.exists).toBe(true);
    expect(result.isDirectory).toBe(true);
  });

  it('delegates getProjectFileIndex and getLocalFilePreview to injected deps', async () => {
    const deps = makeDeps();
    await executeDeviceRpc('getProjectFileIndex', { scope: root }, deps);
    expect(deps.getProjectFileIndex).toHaveBeenCalledWith({ scope: root });

    const previewParams = { path: path.join(root, 'AGENTS.md'), workingDirectory: root };
    await executeDeviceRpc('getLocalFilePreview', previewParams, deps);
    expect(deps.getLocalFilePreview).toHaveBeenCalledWith(previewParams);
  });

  it('routes a git method (listGitBranches) without touching deps', async () => {
    // Not a git repo → the shared local-file-shell impl returns an empty list.
    const result = await executeDeviceRpc('listGitBranches', { path: root }, makeDeps());
    expect(Array.isArray(result)).toBe(true);
  });
});
