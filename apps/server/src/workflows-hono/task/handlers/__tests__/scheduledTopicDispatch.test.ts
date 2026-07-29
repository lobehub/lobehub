import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { scheduledTopicDispatch } from '../scheduledTopicDispatch';

const mocks = vi.hoisted(() => ({
  claimScheduledTopic: vi.fn(),
  clearScheduledRun: vi.fn(),
  deleteMessage: vi.fn(),
  execAgent: vi.fn(),
  findById: vi.fn(),
  getDueScheduledTopics: vi.fn(),
  getServerDB: vi.fn(),
  repointScheduledRunFailedMessage: vi.fn(),
  updateMessage: vi.fn(),
}));

vi.mock('@/database/server', () => ({ getServerDB: mocks.getServerDB }));

vi.mock('@/database/models/topic', () => ({
  TopicModel: {
    claimScheduledTopic: mocks.claimScheduledTopic,
    clearScheduledRun: mocks.clearScheduledRun,
    getDueScheduledTopics: mocks.getDueScheduledTopics,
    repointScheduledRunFailedMessage: mocks.repointScheduledRunFailedMessage,
  },
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    findById = mocks.findById;
    update = mocks.updateMessage;
    deleteMessage = mocks.deleteMessage;
  },
}));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: class {
    execAgent = mocks.execAgent;
  },
}));

const createApp = () => {
  const app = new Hono();
  app.post('/scheduled-topic-dispatch', scheduledTopicDispatch);
  return app;
};

const dispatch = () => createApp().request('/scheduled-topic-dispatch', { method: 'POST' });

const topic = (scheduledRun: unknown) => ({
  agentId: 'agent-1',
  id: 'topic-1',
  metadata: { scheduledRun },
  userId: 'user-1',
  workspaceId: null,
});

const delayedStart = {
  createdAt: '2026-07-12T00:00:00.000Z',
  kind: 'delayed_start',
  runAt: '2026-07-12T03:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
  userMessageId: 'user-scheduled',
};

const resumeAfterRateLimit = {
  createdAt: '2026-07-12T00:00:00.000Z',
  failedAssistantMessageId: 'assistant-failed',
  kind: 'resume_after_rate_limit',
  runAt: '2026-07-12T03:00:00.000Z',
  source: 'heterogeneous_agent',
  updatedAt: '2026-07-12T00:00:00.000Z',
  userMessageId: 'user-message',
};

/** Parked by the pre-`kind` version: no `kind`, no `runAt`, gated on `resetsAt`. */
const legacyRateLimitRun = {
  createdAt: '2026-07-12T00:00:00.000Z',
  failedAssistantMessageId: 'assistant-failed',
  rateLimit: { rateLimitType: '5h', resetsAt: 1_768_000_000 },
  reason: 'rate_limit',
  source: 'heterogeneous_agent',
  updatedAt: '2026-07-12T00:00:00.000Z',
  userMessageId: 'user-message',
};

describe('scheduledTopicDispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerDB.mockResolvedValue({});
    mocks.claimScheduledTopic.mockResolvedValue(true);
    mocks.clearScheduledRun.mockResolvedValue(undefined);
    mocks.execAgent.mockResolvedValue({ success: true });
    mocks.findById.mockImplementation(async (id: string) => ({ content: 'summarize my PRs', id }));
  });

  it('runs a delayed start off its pre-persisted user turn, without writing it twice', async () => {
    mocks.getDueScheduledTopics.mockResolvedValue([topic(delayedStart)]);

    const response = await dispatch();

    await expect(response.json()).resolves.toMatchObject({ claimed: 1, dispatched: 1 });
    // The prompt is read back from the message, not from a copy in the payload —
    // so a pending run the user edited fires with the edited text.
    expect(mocks.findById).toHaveBeenCalledWith('user-scheduled');
    expect(mocks.execAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        appContext: { topicId: 'topic-1' },
        autoStart: true,
        prompt: 'summarize my PRs',
        suppressUserMessage: true,
        trigger: 'scheduled',
      }),
    );
    // A delayed start starts a fresh operation — it is not resuming a prior one.
    expect(mocks.execAgent.mock.calls[0][0]).not.toHaveProperty('resume', true);
    // `suppressUserMessage` writes no user row, so the assistant turn anchors on
    // `parentMessageId` alone — without it the reply persists as a second root and
    // renders above the prompt it answers (LOBE-11489).
    expect(mocks.execAgent.mock.calls[0][0]).toMatchObject({ parentMessageId: 'user-scheduled' });
    // Success hands the run to execAgent, so the topic leaves `scheduled`.
    expect(mocks.clearScheduledRun).toHaveBeenCalledWith(
      {},
      'topic-1',
      'running',
      expect.any(String),
    );
  });

  it('leaves the topic scheduled when the user deleted the pending message', async () => {
    mocks.getDueScheduledTopics.mockResolvedValue([topic(delayedStart)]);
    mocks.findById.mockResolvedValue(undefined);

    const response = await dispatch();

    await expect(response.json()).resolves.toMatchObject({ claimed: 1, dispatched: 0 });
    expect(mocks.execAgent).not.toHaveBeenCalled();
  });

  it('resumes a rate-limited continuation from its failed turn', async () => {
    mocks.getDueScheduledTopics.mockResolvedValue([topic(resumeAfterRateLimit)]);

    await dispatch();

    expect(mocks.execAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        appContext: { topicId: 'topic-1' },
        parentMessageId: 'assistant-failed',
        resume: true,
      }),
    );
  });

  it('clears the rate-limit error card before dispatch, keeping preserved work', async () => {
    mocks.getDueScheduledTopics.mockResolvedValue([topic(resumeAfterRateLimit)]);
    // The failed step streamed content before dying → keep it, only drop the error.
    mocks.findById.mockResolvedValue({
      content: 'partial answer',
      error: { body: { code: 'rate_limit' } },
      id: 'assistant-failed',
    });

    await dispatch();

    expect(mocks.updateMessage).toHaveBeenCalledWith('assistant-failed', { error: null });
    expect(mocks.deleteMessage).not.toHaveBeenCalled();
    // Cleanup runs first — the continuation must never stream in above a stale card.
    expect(mocks.updateMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.execAgent.mock.invocationCallOrder[0],
    );
    expect(mocks.execAgent).toHaveBeenCalledWith(
      expect.objectContaining({ parentMessageId: 'assistant-failed' }),
    );
  });

  it('deletes an error-only failed step and anchors the continuation on its parent', async () => {
    mocks.getDueScheduledTopics.mockResolvedValue([topic(resumeAfterRateLimit)]);
    // Nothing but the error (content is the loading placeholder, no tools).
    mocks.findById.mockResolvedValue({
      content: '...',
      error: { body: { code: 'rate_limit' } },
      id: 'assistant-failed',
      parentId: 'user-message',
    });

    await dispatch();

    expect(mocks.deleteMessage).toHaveBeenCalledWith('assistant-failed');
    expect(mocks.updateMessage).not.toHaveBeenCalled();
    expect(mocks.deleteMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.execAgent.mock.invocationCallOrder[0],
    );
    // The deleted step can't anchor anything — chain onto its parent.
    expect(mocks.execAgent).toHaveBeenCalledWith(
      expect.objectContaining({ parentMessageId: 'user-message', resume: true }),
    );
  });

  it('re-points the schedule at the dispatch-failure bubble so the retry cleans it too', async () => {
    // A failed dispatch leaves a `ServerAgentRuntimeError` bubble on the
    // placeholder execAgent created (finalizeHeteroDispatchError). Without
    // re-pointing, the next successful retry would strand that bubble forever —
    // the same stale-card bug this handler's cleanup exists to prevent.
    mocks.getDueScheduledTopics.mockResolvedValue([topic(resumeAfterRateLimit)]);
    mocks.execAgent.mockResolvedValue({
      assistantMessageId: 'assistant-dispatch-failed',
      error: 'device offline',
      success: false,
    });

    const response = await dispatch();

    await expect(response.json()).resolves.toMatchObject({ dispatched: 0 });
    // Fenced on the dispatcher's claim lease — a stale attempt must not
    // re-point a newer scheduled run.
    expect(mocks.repointScheduledRunFailedMessage).toHaveBeenCalledWith(
      {},
      'topic-1',
      'assistant-dispatch-failed',
      mocks.claimScheduledTopic.mock.calls[0][2].id,
    );
    // The topic itself stays scheduled — the next tick retries.
    expect(mocks.clearScheduledRun).not.toHaveBeenCalled();
  });

  it('retries from the user turn when the failed message is already gone', async () => {
    // A prior tick cleaned the error-only step but its dispatch failed (device
    // offline). The retry must not error out — it falls back to the user turn
    // recorded in the payload.
    mocks.getDueScheduledTopics.mockResolvedValue([topic(resumeAfterRateLimit)]);
    mocks.findById.mockResolvedValue(undefined);

    const response = await dispatch();

    await expect(response.json()).resolves.toMatchObject({ dispatched: 1 });
    expect(mocks.updateMessage).not.toHaveBeenCalled();
    expect(mocks.deleteMessage).not.toHaveBeenCalled();
    expect(mocks.execAgent).toHaveBeenCalledWith(
      expect.objectContaining({ parentMessageId: 'user-message', resume: true }),
    );
  });

  it('leaves the topic scheduled when dispatch fails, so the next tick retries', async () => {
    mocks.getDueScheduledTopics.mockResolvedValue([topic(delayedStart)]);
    mocks.execAgent.mockResolvedValue({ error: 'device offline', success: false });

    const response = await dispatch();

    await expect(response.json()).resolves.toMatchObject({ claimed: 1, dispatched: 0 });
    expect(mocks.clearScheduledRun).not.toHaveBeenCalled();
    // Only the resume kind has a cleanup phase to hand the bubble to.
    expect(mocks.repointScheduledRunFailedMessage).not.toHaveBeenCalled();
  });

  it('dispatches a continuation parked by the pre-`kind` version, rather than discarding it', async () => {
    // Upgrade-day rows: written before `kind`/`runAt` existed. Discarding them
    // would silently drop a continuation the user is still waiting on.
    mocks.getDueScheduledTopics.mockResolvedValue([topic(legacyRateLimitRun)]);

    const response = await dispatch();

    await expect(response.json()).resolves.toMatchObject({
      discarded: 0,
      dispatched: 1,
    });
    expect(mocks.execAgent).toHaveBeenCalledWith(
      expect.objectContaining({ parentMessageId: 'assistant-failed', resume: true }),
    );
  });

  it('discards an unparseable payload instead of re-surfacing it every tick', async () => {
    // `runAt` is present (so the due query returns it) but the kind is unknown —
    // no handler can run it, and skipping would spin forever.
    mocks.getDueScheduledTopics.mockResolvedValue([
      topic({ kind: 'who_knows', runAt: '2026-07-12T03:00:00.000Z' }),
    ]);

    const response = await dispatch();

    await expect(response.json()).resolves.toMatchObject({ discarded: 1, dispatched: 0 });
    expect(mocks.claimScheduledTopic).not.toHaveBeenCalled();
    expect(mocks.execAgent).not.toHaveBeenCalled();
    expect(mocks.clearScheduledRun).toHaveBeenCalledWith({}, 'topic-1', 'active');
  });

  it('skips a topic another replica already claimed', async () => {
    mocks.getDueScheduledTopics.mockResolvedValue([topic(delayedStart)]);
    mocks.claimScheduledTopic.mockResolvedValue(false);

    const response = await dispatch();

    await expect(response.json()).resolves.toMatchObject({ claimed: 0, dispatched: 0 });
    expect(mocks.execAgent).not.toHaveBeenCalled();
  });
});
