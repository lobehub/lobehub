import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ViewedTaskContextModule from '../viewedTaskContext';
import { prepareHeteroRun } from './prepare';
import type { HeteroDispatchDeps } from './types';

const mocks = vi.hoisted(() => {
  /**
   * The required reads and the two best-effort reads all wait on one barrier
   * that opens only once every one of them has started. Run one after another,
   * the first waits for a barrier the rest never reach and the test times out.
   */
  const STAGE_COUNT = 5;
  const started: string[] = [];
  let openBarrier: () => void = () => {};
  let barrier = new Promise<void>((resolve) => {
    openBarrier = resolve;
  });
  const gated =
    <T>(stage: string, value: () => T) =>
    async () => {
      started.push(stage);
      if (started.length >= STAGE_COUNT) openBarrier();
      await barrier;
      return value();
    };

  const span = (name: string) => ({
    end: vi.fn(() => spans.ended.push(name)),
    setAttribute: vi.fn(),
    setStatus: vi.fn(() => spans.failed.push(name)),
  });
  const spans = { ended: [] as string[], failed: [] as string[] };

  return {
    gated,
    getFullFileUrl: vi.fn(),
    getResumeSessionId: vi.fn(),
    reset: () => {
      started.length = 0;
      spans.ended.length = 0;
      spans.failed.length = 0;
      barrier = new Promise<void>((resolve) => {
        openBarrier = resolve;
      });
    },
    resolveSandboxSessionConfig: vi.fn(),
    signHeteroOperationJWT: vi.fn(),
    span,
    spans,
    started,
  };
});

vi.mock('@lobechat/observability-otel/modules/agent-runtime', () => ({
  tracer: {
    startActiveSpan: (name: string, fn: (span: unknown) => unknown) => fn(mocks.span(name)),
  },
}));

vi.mock('@/server/services/heterogeneousAgent', () => ({
  HeterogeneousAgentService: vi.fn().mockImplementation(function () {
    return { getHeterogeneousResumeSessionId: mocks.getResumeSessionId };
  }),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(function () {
    return { getFullFileUrl: mocks.getFullFileUrl };
  }),
}));

vi.mock('@/libs/trpc/utils/internalJwt', () => ({
  signHeteroOperationJWT: mocks.signHeteroOperationJWT,
}));

vi.mock('@/server/services/sandbox/session', () => ({
  resolveSandboxSessionConfig: mocks.resolveSandboxSessionConfig,
}));

vi.mock('../viewedTaskContext', async (importOriginal) => ({
  ...(await importOriginal<typeof ViewedTaskContextModule>()),
  buildViewedTaskContextPrompt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../projectContext', () => ({
  buildHeteroProjectContext: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../finalizeHeteroDispatchError', () => ({ finalizeHeteroDispatchError: vi.fn() }));

const createDeps = () => {
  const credsGet = vi.fn().mockResolvedValue({ plaintext: { access_token: 'gh-token' } });
  const marketService = {
    market: {
      creds: {
        get: credsGet,
        list: mocks.gated('github_token', () => ({ data: [{ id: 'cred-1', key: 'github' }] })),
      },
    },
  };
  const topicModel = {
    findById: vi.fn(mocks.gated('topic', () => ({ metadata: { repos: ['lobehub/lobehub'] } }))),
  };
  const messageModel = {
    query: vi.fn(
      mocks.gated('history', () => [
        { content: 'earlier question', id: 'm-1', role: 'user' },
        { content: 'earlier answer', id: 'm-2', role: 'assistant' },
      ]),
    ),
  };
  const deps = {
    bindTopicWorkingDirectory: vi.fn(),
    db: {} as any,
    getMarketService: vi.fn().mockResolvedValue(marketService),
    messageModel: messageModel as any,
    resolveDeviceWorkspaceId: vi.fn(),
    topicModel: topicModel as any,
    userId: 'user-1',
    withholdGatewayToken: false,
  } satisfies HeteroDispatchDeps;
  return { credsGet, deps, messageModel, topicModel };
};

const ctx = {
  agentConfig: { agencyConfig: {}, id: 'agent-1' },
  assistantMessageId: 'asst-1',
  prompt: 'hello',
  topicId: 'topic-1',
  trigger: 'chat',
  userMessageId: 'user-msg-1',
} as any;

const input = {
  heteroType: 'claude-code' as const,
  runAttachments: { audioList: [], fileList: [], imageList: [], videoList: [] },
  selfMessageIds: new Set<string>(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reset();
  mocks.getResumeSessionId.mockImplementation(mocks.gated('resume_session', () => undefined));
  mocks.signHeteroOperationJWT.mockImplementation(mocks.gated('sign_operation_jwt', () => 'jwt'));
  mocks.resolveSandboxSessionConfig.mockResolvedValue(undefined);
});

describe('prepareHeteroRun — overlapping reads', () => {
  it('starts the resume, JWT, topic, GitHub and history reads together', async () => {
    const { credsGet, deps } = createDeps();

    const prepared = await prepareHeteroRun(deps, ctx, input, 'op-1');

    expect(mocks.started.toSorted()).toEqual(
      ['github_token', 'history', 'resume_session', 'sign_operation_jwt', 'topic'].toSorted(),
    );
    expect(credsGet).toHaveBeenCalledWith('cred-1', { decrypt: true });
    expect(prepared.heteroParams).toMatchObject({
      githubToken: 'gh-token',
      jwt: 'jwt',
      repos: ['lobehub/lobehub'],
    });
    expect(prepared.conversationHistory).toEqual([
      { content: 'earlier question', role: 'user' },
      { content: 'earlier answer', role: 'assistant' },
    ]);
    expect(mocks.resolveSandboxSessionConfig).toHaveBeenCalledTimes(1);
    // Every stage span closed, none marked failed.
    expect(mocks.spans.ended).toEqual(
      expect.arrayContaining([
        'hetero_dispatch github_token',
        'hetero_dispatch history',
        'hetero_dispatch resume_session',
        'hetero_dispatch sandbox_session',
        'hetero_dispatch sign_operation_jwt',
        'hetero_dispatch system_context',
        'hetero_dispatch topic',
      ]),
    );
    expect(mocks.spans.failed).toEqual([]);
  });

  it('keeps the best-effort reads best-effort when they fail', async () => {
    const { deps, messageModel, topicModel } = createDeps();
    deps.getMarketService.mockRejectedValue(new Error('market down'));
    messageModel.query.mockRejectedValue(new Error('db down'));
    topicModel.findById.mockResolvedValue({ metadata: {} });
    mocks.getResumeSessionId.mockResolvedValue(undefined);
    mocks.signHeteroOperationJWT.mockResolvedValue('jwt');

    const prepared = await prepareHeteroRun(deps, ctx, input, 'op-1');

    expect(prepared.heteroParams.githubToken).toBeUndefined();
    expect(prepared.conversationHistory).toBeUndefined();
    expect(prepared.heteroParams.jwt).toBe('jwt');
  });

  it('surfaces the JWT failure before a later topic failure and never places the sandbox', async () => {
    const { deps, topicModel } = createDeps();
    mocks.signHeteroOperationJWT.mockImplementation(async () => {
      // Fails last in time, but came first in the old sequence.
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error('kms unavailable');
    });
    topicModel.findById.mockRejectedValue(new Error('topic read failed'));
    mocks.getResumeSessionId.mockResolvedValue(undefined);

    await expect(prepareHeteroRun(deps, ctx, input, 'op-1')).rejects.toThrow(
      'Failed to sign operation JWT for hetero agent',
    );
    // The placement may create a drive folder: it waits for the required reads.
    expect(mocks.resolveSandboxSessionConfig).not.toHaveBeenCalled();
    // The failed stages still closed their spans and recorded the error.
    expect(mocks.spans.failed).toEqual(
      expect.arrayContaining(['hetero_dispatch sign_operation_jwt', 'hetero_dispatch topic']),
    );
    expect(mocks.spans.ended).toEqual(
      expect.arrayContaining(['hetero_dispatch sign_operation_jwt', 'hetero_dispatch topic']),
    );
  });

  it('keeps the text history when signing an unanswered attachment fails', async () => {
    const { deps, messageModel, topicModel } = createDeps();
    topicModel.findById.mockResolvedValue({ metadata: {} });
    deps.getMarketService.mockRejectedValue(new Error('market down'));
    mocks.getResumeSessionId.mockResolvedValue('session-1');
    mocks.signHeteroOperationJWT.mockResolvedValue('jwt');
    mocks.getFullFileUrl.mockRejectedValue(new Error('signing failed'));
    messageModel.query.mockResolvedValue([
      { content: 'earlier question', id: 'm-1', role: 'user' },
      { content: 'earlier answer', id: 'm-2', role: 'assistant' },
      {
        content: 'stopped before the CLI saw it',
        fileList: [{ name: 'spec.pdf', url: 'files/spec.pdf' }],
        id: 'm-3',
        role: 'user',
      },
    ]);

    const prepared = await prepareHeteroRun(deps, ctx, input, 'op-1');

    expect(mocks.getFullFileUrl).toHaveBeenCalledWith('files/spec.pdf');
    expect(prepared.conversationHistory).toEqual([
      { content: 'earlier question', role: 'user' },
      { content: 'earlier answer', role: 'assistant' },
      { content: 'stopped before the CLI saw it', role: 'user' },
    ]);
    expect(prepared.unansweredUserTurns).toBeUndefined();
    // A resumed run still gets its fallback context built from that history.
    expect(prepared.heteroParams.resumeFallbackSystemContext).toBeDefined();
  });
});
