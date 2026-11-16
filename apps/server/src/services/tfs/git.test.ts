import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runTfsGit } from './git';

const mocks = vi.hoisted(() => ({
  creator: vi.fn(),
  use: vi.fn(),
  topic: vi.fn(),
  settings: vi.fn(),
  resolve: vi.fn(),
  call: vi.fn(),
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    findById = mocks.topic;
  },
}));
vi.mock('@/database/models/user', () => ({
  UserModel: class {
    getUserSettings = mocks.settings;
  },
}));
vi.mock('@/server/routers/lambda/_helpers/conversationResourceGuard', () => ({
  assertCanUseTopicTargets: mocks.use,
}));
vi.mock('@/server/routers/lambda/_helpers/shareVisitorTargetGuard', () => ({
  assertCreatorTopicTargets: mocks.creator,
}));
vi.mock('@/server/services/market', () => ({ MarketService: class {} }));
vi.mock('@/server/services/sandbox', () => ({
  resolveSandboxSessionConfig: mocks.resolve,
  createSandboxService: () => ({ callTool: mocks.call }),
}));

const deps = { db: {} as never, userId: 'caller', workspaceId: 'ws' };
const input = { operation: 'fetch' as const, sourceIndex: 0, topicId: 'topic' };
const initialization = {
  environmentId: 'env',
  name: 'TFS',
  cloneCredential: {
    tfs: { authType: 'pat', username: '', secret: 'personal-secret' },
    urlPrefix: 'https://dev.example.com/C/',
  },
  sources: [{ url: 'https://dev.example.com/C/P/_git/R', ref: 'main' }],
};

describe('TFS Git authorization and result boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.topic.mockResolvedValue({ metadata: { sandboxEnvironmentId: 'env' } });
    mocks.resolve.mockResolvedValue({ initialization, drive: 'personal', cwd: 'projects/p/env' });
    mocks.settings.mockResolvedValue({});
    mocks.call.mockResolvedValue({ success: true, result: { stdout: 'fetched', stderr: '' } });
  });

  it('executes a permitted operation and returns output without exposing credentials', async () => {
    mocks.call.mockResolvedValue({
      success: true,
      result: { stdout: 'fetched personal-secret', stderr: '', command: 'never return this' },
    });
    expect(await runTfsGit(deps, input)).toEqual({
      success: true,
      exitCode: 0,
      stdout: 'fetched [redacted]',
      stderr: '',
      error: undefined,
    });
  });

  it('stops before execution when conversation USE permission is denied', async () => {
    mocks.use.mockRejectedValue(new Error('denied'));
    await expect(runTfsGit(deps, input)).rejects.toThrow('denied');
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('refuses agent-share visitors', async () => {
    mocks.topic.mockResolvedValue({
      senderId: 'visitor',
      metadata: { sandboxEnvironmentId: 'env' },
    });
    await expect(runTfsGit(deps, input)).rejects.toThrow('Topic not found');
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it.each([
    { initialization: undefined },
    { initialization: { ...initialization, authorizationError: 'unavailable' } },
    { initialization: { ...initialization, authorizationError: 'sharedDrive' } },
    { initialization: { ...initialization, cloneCredential: undefined } },
    { initialization, mode: 'drive', drive: 'public' },
  ])('refuses unavailable or shared authorization %#', async (sandbox) => {
    mocks.resolve.mockResolvedValue(sandbox);
    await expect(runTfsGit(deps, input)).rejects.toThrow();
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('allows a temporary workspace sandbox whose unused drive default is public', async () => {
    mocks.resolve.mockResolvedValue({ initialization, mode: 'ephemeral', drive: 'public' });
    expect(await runTfsGit(deps, input)).toMatchObject({ success: true });
  });

  it('never operates on another source or guesses a default push branch', async () => {
    await expect(runTfsGit(deps, { ...input, sourceIndex: 4 })).rejects.toThrow(
      'Select a TFS source',
    );
    mocks.resolve.mockResolvedValue({
      initialization: { ...initialization, sources: [{ url: initialization.sources[0].url }] },
    });
    await expect(runTfsGit(deps, { ...input, operation: 'push' })).rejects.toThrow(
      'Specify the target branch',
    );
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('does not forward provider exceptions containing their credential-bearing request', async () => {
    mocks.call.mockRejectedValue(new Error('request contains personal-secret'));
    await expect(runTfsGit(deps, input)).rejects.toThrow(
      'TFS Git operation failed. Check sandbox connectivity and repository permissions.',
    );
  });

  it('reports a rejected Git process as failure even when the sandbox tool call succeeds', async () => {
    mocks.call.mockResolvedValue({
      success: true,
      result: { exitCode: 1, stdout: '', stderr: 'non-fast-forward' },
    });
    expect(await runTfsGit(deps, { ...input, operation: 'push' })).toMatchObject({
      success: false,
      exitCode: 1,
      stderr: 'non-fast-forward',
    });
  });
});
