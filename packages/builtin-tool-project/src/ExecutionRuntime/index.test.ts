import { describe, expect, it, vi } from 'vitest';

import type { ProjectToolService } from '../types';
import { applyEnvironmentEdit, ProjectExecutionRuntime, sameRepository } from './index';

const service = (overrides: Partial<ProjectToolService> = {}): ProjectToolService => ({
  addRunner: vi.fn(),
  getEnvironment: vi.fn(),
  listRunners: vi.fn(),
  removeRunner: vi.fn(),
  reorderRunners: vi.fn(),
  updateEnvironment: vi.fn(),
  ...overrides,
});

describe('ProjectExecutionRuntime', () => {
  it('lists runners in order, marks the current one and the addable devices', async () => {
    const runtime = new ProjectExecutionRuntime(
      service({
        listRunners: vi.fn().mockResolvedValue({
          devices: [{ deviceId: 'dev-2', name: 'Studio', online: false, platform: 'darwin' }],
          runners: [
            {
              current: true,
              deviceId: 'dev-1',
              deviceName: 'Laptop',
              id: 'dir-1',
              kind: 'device',
              online: true,
              path: '/work/app',
              runnable: true,
            },
            { id: 'sandbox', kind: 'sandbox' },
          ],
        }),
      }),
    );

    const result = await runtime.listRunners();

    expect(result.success).toBe(true);
    expect(result.content).toContain('1. dir-1 · Laptop · online · /work/app ← this conversation');
    expect(result.content).toContain('2. sandbox · cloud sandbox');
    expect(result.content).toContain('- dev-2 · Studio (darwin) · offline');
  });

  it('refuses to remove the cloud sandbox without calling the service', async () => {
    const removeRunner = vi.fn();
    const result = await new ProjectExecutionRuntime(service({ removeRunner })).removeRunner({
      runnerId: 'sandbox',
    });

    expect(result.success).toBe(false);
    expect(removeRunner).not.toHaveBeenCalled();
  });

  it('turns a service error into a failed result the agent can read', async () => {
    const result = await new ProjectExecutionRuntime(
      service({ addRunner: vi.fn().mockRejectedValue(new Error('Working directory missing')) }),
    ).addRunner({ deviceId: 'dev-1', path: '/nope' });

    expect(result).toMatchObject({ content: 'Working directory missing', success: false });
  });
});

describe('applyEnvironmentEdit', () => {
  const stored = {
    bootstrapCommand: 'pnpm i',
    env: { REGION: 'us' },
    notes: 'needs docker',
    sources: [{ kind: 'git', ref: 'main', url: 'https://github.com/acme/app' }],
  };

  it('changes only the parts given and keeps variables', () => {
    expect(applyEnvironmentEdit(stored, { setupCommand: 'bun i' })).toEqual({
      ...stored,
      bootstrapCommand: 'bun i',
    });
  });

  it('clears setup and notes with an empty string', () => {
    const next = applyEnvironmentEdit(stored, { notes: '', setupCommand: '' });
    expect(next.bootstrapCommand).toBeUndefined();
    expect(next.notes).toBeUndefined();
  });

  it('removes, then adds repositories without duplicating a listed one', () => {
    const next = applyEnvironmentEdit(stored, {
      addRepositories: [
        { url: 'https://github.com/acme/app.git' },
        { ref: 'dev', url: 'https://github.com/acme/api' },
      ],
      removeRepositories: [],
    });
    expect(next.sources).toEqual([
      stored.sources[0],
      { kind: 'git', ref: 'dev', url: 'https://github.com/acme/api' },
    ]);
    expect(
      applyEnvironmentEdit(stored, { removeRepositories: ['https://github.com/ACME/app/'] })
        .sources,
    ).toEqual([]);
  });
});

describe('sameRepository', () => {
  it('ignores .git, trailing slash and case', () => {
    expect(sameRepository('https://github.com/a/b.git', 'https://GitHub.com/a/b/')).toBe(true);
    expect(sameRepository('https://github.com/a/b', 'https://github.com/a/c')).toBe(false);
  });
});
