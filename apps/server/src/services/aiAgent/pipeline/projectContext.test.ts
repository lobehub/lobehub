// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildHeteroProjectContext,
  buildRunProjectContextPrompt,
  resolveSandboxRepository,
  runReachesCloudSandbox,
  toCredentialFreeRepositoryUrl,
} from './projectContext';

const mocks = vi.hoisted(() => ({
  resolveTopicCheckoutConfiguration: vi.fn(),
  findById: vi.fn(),
  listAgents: vi.fn(),
  listKnowledgeBases: vi.fn(),
  listTasks: vi.fn(),
  resolveCoordinatorAgents: vi.fn(async (items: unknown[]) => items),
}));

vi.mock('@/database/models/project', () => ({
  ProjectModel: vi.fn().mockImplementation(function () {
    return mocks;
  }),
}));

vi.mock('@/server/services/sandbox/session', () => ({
  resolveTopicCheckoutConfiguration: mocks.resolveTopicCheckoutConfiguration,
}));

const deps = { db: {} as never, userId: 'user-1' };

describe('buildRunProjectContextPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findById.mockResolvedValue({
      coordinatorAgentId: 'agt-coord',
      description: 'Autumn launch',
      identifier: 'APO',
      name: 'Apollo Renamed',
      status: 'active',
    });
    mocks.listAgents.mockResolvedValue([
      { agent: { id: 'agt-coord', title: 'Coordinator' }, binding: { enabled: true } },
      { agent: { id: 'agt-writer', title: 'Writer' }, binding: { enabled: true, role: 'copy' } },
      { agent: { id: 'agt-off', title: 'Paused' }, binding: { enabled: false, role: 'qa' } },
    ]);
    mocks.listKnowledgeBases.mockResolvedValue([
      { binding: { enabled: true }, knowledgeBase: { id: 'kb-1', name: 'Style guide' } },
      { binding: { enabled: false }, knowledgeBase: { id: 'kb-2', name: 'Old notes' } },
    ]);
    mocks.listTasks.mockResolvedValue([
      { identifier: 'APO-1', name: 'Done', status: 'completed' },
      { assigneeAgentId: 'agt-writer', identifier: 'APO-2', name: 'Draft', status: 'running' },
      { identifier: 'APO-3', name: 'Dropped', status: 'canceled' },
    ]);
  });

  it('reads the live project so renames and membership changes reach the next turn', async () => {
    const prompt = await buildRunProjectContextPrompt(deps, 'proj-1', 'agt-coord');

    expect(prompt).toContain('Apollo Renamed');
    expect(prompt).toContain('Writer (agt-writer): copy');
    expect(prompt).not.toContain('agt-off');
    expect(prompt).toContain('Style guide (kb-1)');
    expect(prompt).not.toContain('Old notes');
    expect(prompt).toContain('<open_tasks total="1">');
    expect(prompt).toContain('APO-2');
    expect(prompt).not.toContain('APO-1');
    expect(prompt).toContain('<coordination_rules>');
  });

  it('treats LobeAI as the coordinator of a project whose main agent was cleared', async () => {
    mocks.findById.mockResolvedValue({
      coordinatorAgentId: null,
      identifier: 'APO',
      name: 'Apollo',
      status: 'active',
    });
    mocks.resolveCoordinatorAgents.mockImplementationOnce(async (items: any[]) =>
      items.map((item) => ({ ...item, coordinatorAgentId: 'agt-inbox' })),
    );

    const prompt = await buildRunProjectContextPrompt(deps, 'proj-1', 'agt-inbox');

    expect(prompt).toContain('<coordination_rules>');
  });

  it('adds nothing outside a project or when the project is gone', async () => {
    await expect(buildRunProjectContextPrompt(deps, undefined, 'agt-coord')).resolves.toBe(
      undefined,
    );
    mocks.findById.mockResolvedValue(null);
    await expect(buildRunProjectContextPrompt(deps, 'proj-1', 'agt-coord')).resolves.toBe(
      undefined,
    );
  });

  it('degrades to no project block when a read fails', async () => {
    mocks.listTasks.mockRejectedValue(new Error('connection reset'));

    await expect(buildRunProjectContextPrompt(deps, 'proj-1', 'agt-coord')).resolves.toBe(
      undefined,
    );
  });

  it('gives a CLI agent the wrapped context without tool-specific delegation rules', async () => {
    const context = await buildHeteroProjectContext(deps, 'proj-1', 'agt-coord');

    expect(context?.startsWith('<project_context>\n')).toBe(true);
    expect(context?.endsWith('\n</project_context>')).toBe(true);
    expect(context).toContain('Writer (agt-writer): copy');
    expect(context).not.toContain('<coordination_rules>');
    await expect(buildHeteroProjectContext(deps, undefined, 'agt-coord')).resolves.toBe(undefined);
  });

  it('names the checkout of a sandbox run so the agent reads the code from its first turn', async () => {
    mocks.resolveTopicCheckoutConfiguration.mockResolvedValue({
      configuration: {
        sources: [{ kind: 'git', ref: 'main', url: 'https://github.com/lobehub/lobehub' }],
      },
      name: 'lobehub/lobehub',
    });

    const prompt = await buildRunProjectContextPrompt(deps, 'proj-1', 'agt-coord', {
      sandboxTopicId: 'tpc-1',
    });

    expect(mocks.resolveTopicCheckoutConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ topicId: 'tpc-1', userId: 'user-1' }),
    );
    expect(prompt).toContain(
      '<working_directory repository="https://github.com/lobehub/lobehub" branch="main">',
    );
  });

  it('says nothing about a checkout when the run is not in the sandbox', async () => {
    const prompt = await buildRunProjectContextPrompt(deps, 'proj-1', 'agt-coord');

    expect(mocks.resolveTopicCheckoutConfiguration).not.toHaveBeenCalled();
    expect(prompt).not.toContain('<working_directory');
  });
});

describe('resolveSandboxRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('takes the first git source of the environment the topic picked', async () => {
    mocks.resolveTopicCheckoutConfiguration.mockResolvedValue({
      configuration: { sources: [{ kind: 'git', url: 'https://github.com/a/b' }] },
      name: 'a/b',
    });

    await expect(resolveSandboxRepository(deps, 'tpc-1')).resolves.toEqual({
      name: 'a/b',
      ref: undefined,
      url: 'https://github.com/a/b',
    });
  });

  it('names nothing for no environment, one without a repository, or a failed read', async () => {
    mocks.resolveTopicCheckoutConfiguration.mockResolvedValueOnce(undefined);
    await expect(resolveSandboxRepository(deps, 'tpc-1')).resolves.toBeUndefined();

    mocks.resolveTopicCheckoutConfiguration.mockResolvedValueOnce({
      configuration: { bootstrapCommand: 'pnpm i', sources: [] },
      name: 'setup only',
    });
    await expect(resolveSandboxRepository(deps, 'tpc-1')).resolves.toBeUndefined();

    mocks.resolveTopicCheckoutConfiguration.mockRejectedValueOnce(new Error('connection reset'));
    await expect(resolveSandboxRepository(deps, 'tpc-1')).resolves.toBeUndefined();
  });

  it('never hands a token stored in the source URL to the model', async () => {
    mocks.resolveTopicCheckoutConfiguration.mockResolvedValue({
      configuration: {
        sources: [
          {
            kind: 'git',
            path: './web/',
            url: 'https://x-access-token:ghs_secret@github.com/a/b.git?t=1#x',
          },
        ],
      },
      name: 'a/b',
    });

    const repository = await resolveSandboxRepository(deps, 'tpc-1');

    expect(repository).toEqual({
      name: 'a/b',
      path: 'web',
      ref: undefined,
      url: 'https://github.com/a/b.git',
    });
    expect(JSON.stringify(repository)).not.toContain('ghs_secret');
  });
});

describe('toCredentialFreeRepositoryUrl', () => {
  it('drops userinfo, query and fragment, and reads scp-style remotes', () => {
    expect(toCredentialFreeRepositoryUrl('https://user:pw@github.com/a/b?x=1#y')).toBe(
      'https://github.com/a/b',
    );
    expect(toCredentialFreeRepositoryUrl('ssh://git@host:2222/a/b.git')).toBe(
      'ssh://host:2222/a/b.git',
    );
    expect(toCredentialFreeRepositoryUrl('git@github.com:a/b.git')).toBe('github.com:a/b.git');
  });

  it('refuses what it cannot read as a repository URL', () => {
    expect(toCredentialFreeRepositoryUrl('not a url')).toBeUndefined();
    expect(toCredentialFreeRepositoryUrl('file:///etc/passwd')).toBeUndefined();
  });
});

describe('runReachesCloudSandbox', () => {
  it('counts the Cloud Sandbox tool whether or not a device is routed', () => {
    expect(
      runReachesCloudSandbox({ deviceRouted: true, enabledToolIds: ['lobe-cloud-sandbox'] }),
    ).toBe(true);
  });

  it('counts Skills only while no device is routed, since a device runs its commands', () => {
    expect(runReachesCloudSandbox({ deviceRouted: false, enabledToolIds: ['lobe-skills'] })).toBe(
      true,
    );
    expect(runReachesCloudSandbox({ deviceRouted: true, enabledToolIds: ['lobe-skills'] })).toBe(
      false,
    );
    expect(runReachesCloudSandbox({ deviceRouted: false, enabledToolIds: [] })).toBe(false);
  });
});
