// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DocumentRewriteRequestModel } from '@/database/models/documentRewriteRequest';

import {
  DOCUMENT_REWRITE_MOCK_MODEL,
  DOCUMENT_REWRITE_MOCK_PROVIDER,
  DOCUMENT_REWRITE_MOCK_REPLACEMENT_TEXT_ENV,
} from './productionGenerator';
import {
  getDocumentRewriteRuntimeStatus,
  initializeDocumentRewriteRuntime,
  recoverDocumentRewriteRuntime,
  resetDocumentRewriteRuntimeForTests,
} from './runtime';

describe('document rewrite runtime composition', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetDocumentRewriteRuntimeForTests();
  });

  const createRecoveryDb = () => {
    let queryCount = 0;
    const select = vi.fn(() => {
      const rows =
        queryCount++ % 2 === 0 ? [{ requestedByUserId: 'recovery-user', workspaceId: null }] : [];
      const limit = vi.fn(async () => rows);
      const where = vi.fn(() => ({ limit, orderBy: () => ({ limit }) }));
      return { from: () => ({ where }) };
    });
    return { db: { select } as never, select };
  };

  it('initializes a local durable queue without module-import side effects', async () => {
    expect(getDocumentRewriteRuntimeStatus()).toMatchObject({
      configured: true,
      initialized: false,
      mode: 'local',
    });
    const composed = await initializeDocumentRewriteRuntime();
    expect(composed.queue).toBeDefined();
    expect(getDocumentRewriteRuntimeStatus()).toMatchObject({ initialized: true });
  });

  it('wires the development deterministic generator through the default worker composition', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv(DOCUMENT_REWRITE_MOCK_REPLACEMENT_TEXT_ENV, 'UI deterministic replacement');

    const composed = await initializeDocumentRewriteRuntime();
    const worker = composed.createWorker({ db: {} as never });
    const generatorFactory = (
      worker as unknown as {
        generatorFactory?: (context: {
          agentId: string;
          requestedByUserId: string;
          workspaceId: string | null;
        }) => { generate: (input: unknown) => Promise<unknown> };
      }
    ).generatorFactory;

    expect(generatorFactory).toEqual(expect.any(Function));
    const generator = generatorFactory?.({
      agentId: 'agent-1',
      requestedByUserId: 'user-1',
      workspaceId: null,
    });
    await expect(
      generator?.generate({
        agentId: 'agent-1',
        attempt: 1,
        instruction: 'rewrite',
        quotedText: 'original',
        requestId: 'request-1',
        signal: new AbortController().signal,
        topicId: 'topic-1',
        targetNodeIds: Object.freeze(['node-1']),
      }),
    ).resolves.toMatchObject({
      model: DOCUMENT_REWRITE_MOCK_MODEL,
      provider: DOCUMENT_REWRITE_MOCK_PROVIDER,
      replacementText: 'UI deterministic replacement',
    });
  });

  it('runs one bounded recovery scan for concurrent callers', async () => {
    const { db, select } = createRecoveryDb();
    const sweepPendingReviews = vi
      .spyOn(DocumentRewriteRequestModel.prototype, 'sweepPendingReviews')
      .mockResolvedValue(0);
    const errors: unknown[] = [];

    await Promise.all([
      recoverDocumentRewriteRuntime(db, 50, { onError: (error) => errors.push(error) }),
      recoverDocumentRewriteRuntime(db),
    ]);
    expect(errors).toEqual([]);
    expect(sweepPendingReviews).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledTimes(2);
  });

  it('allows a later recovery scan after the cooldown while suppressing request storms', async () => {
    vi.useFakeTimers();
    const { db, select } = createRecoveryDb();
    const sweepPendingReviews = vi
      .spyOn(DocumentRewriteRequestModel.prototype, 'sweepPendingReviews')
      .mockResolvedValue(0);
    const errors: unknown[] = [];

    await recoverDocumentRewriteRuntime(db, 50, { onError: (error) => errors.push(error) });
    await recoverDocumentRewriteRuntime(db);
    expect(select).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_001);
    await recoverDocumentRewriteRuntime(db, 50, { onError: (error) => errors.push(error) });
    expect(errors).toEqual([]);
    expect(sweepPendingReviews).toHaveBeenCalledTimes(2);
    expect(select).toHaveBeenCalledTimes(4);
  });
});
