import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectEnvironmentOption } from '../useProjectEnvironmentOption';

const mocks = vi.hoisted(() => ({
  environments: [] as { configuration: object; id: string; name: string }[],
  pending: undefined as object | undefined,
  placement: {
    projectId: 'project-1' as string | undefined,
    selection: {} as Record<string, unknown>,
    setSelection: vi.fn(),
  },
  seeded: false,
}));

vi.mock('../useSandboxPlacement', () => ({
  isPersistentSelection: (selection: { instanceId?: string; workingDirectory?: string }) =>
    !!selection.instanceId || selection.workingDirectory !== undefined,
  useSandboxPlacement: () => mocks.placement,
}));

vi.mock('../useSandboxEnvironmentList', () => ({
  useIsSharedAgent: () => false,
  useProjectSandboxEnvironments: () => ({ environments: mocks.environments }),
}));

vi.mock('@/store/chat/pendingSandboxSelection', () => ({
  getPendingSandboxSelection: () => mocks.pending,
  isSeededSandboxSelection: () => mocks.seeded,
  subscribePendingSandboxSelection: () => () => {},
}));

const projectEnvironment = {
  configuration: { sources: [{ kind: 'git', url: 'https://github.com/org/app' }] },
  id: 'env-1',
  name: 'app',
};

const render = (topicId: string | null) =>
  renderHook(() => useProjectEnvironmentOption('agent-1', topicId)).result.current;

beforeEach(() => {
  mocks.environments = [projectEnvironment];
  mocks.pending = undefined;
  mocks.seeded = false;
  mocks.placement.projectId = 'project-1';
  mocks.placement.selection = {};
  mocks.placement.setSelection.mockReset().mockResolvedValue(undefined);
});

describe('useProjectEnvironmentOption', () => {
  // The server applies the project's environment to a conversation nobody placed.
  it('is the default of a new project conversation nobody placed', () => {
    expect(render(null)).toMatchObject({ projectDefault: true, selected: true });

    mocks.pending = { drive: 'personal', workingDirectory: '.' };
    mocks.seeded = true;
    expect(render(null)).toMatchObject({ projectDefault: true, selected: true });
  });

  it('gives way to a pick', () => {
    mocks.pending = {};
    expect(render(null)).toMatchObject({ projectDefault: false, selected: false });
  });

  it("follows an open conversation's own environment", () => {
    mocks.placement.selection = { environmentId: 'env-1' };
    expect(render('topic-1')).toMatchObject({ projectDefault: false, selected: true });

    mocks.placement.selection = { environmentId: 'env-1', workingDirectory: 'notes' };
    expect(render('topic-1').selected).toBe(false);

    mocks.placement.selection = {};
    expect(render('topic-1').selected).toBe(false);
  });

  it('offers nothing outside a project or without a repository to clone', () => {
    mocks.environments = [];
    expect(render(null)).toMatchObject({ environment: undefined, selected: false });
  });

  it('runs the conversation in a temporary sandbox set up from it', async () => {
    await render('topic-1').apply();
    expect(mocks.placement.setSelection).toHaveBeenCalledWith({ environmentId: 'env-1' });
  });
});
