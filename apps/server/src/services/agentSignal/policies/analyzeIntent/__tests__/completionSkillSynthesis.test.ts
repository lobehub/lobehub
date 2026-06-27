// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CompletionLifecycle } from '@/server/services/agentRuntime/CompletionLifecycle';
import * as agentSignalService from '@/server/services/agentSignal';

import type { RuntimeProcessorContext } from '../../../runtime/context';
import { createCompletionSkillSynthesisSourceHandler } from '../completionSkillSynthesis';
import type { PendingSkillSynthesis, RecordedSkillIntent } from '../skillIntentRecord';

/**
 * LOBE-10802 — deferred skill synthesis on `agent.execution.completed`.
 *
 * These tests pin the completion-stage handler in isolation: the parked
 * candidate is read, the turn trajectory (tool sequence + final product) is
 * assembled into the synthesis prompt, the skill seed anchors to the completed
 * assistant message (not a floating mainline root), and the candidate is
 * consumed exactly once so a duplicate completion cannot re-synthesize.
 */

const TOPIC_ID = 'tpc_1';
const USER_MESSAGE_ID = 'msg_user';
const ASSISTANT_MESSAGE_ID = 'msg_assistant';
const USER_REQUEST =
  'Assign T199 to device 2, research and build an MVP, then write a complete report.';

// The assistant turn's tool sequence — the reusable "how" that the inbound
// prompt alone could not capture (it did not exist yet at user-message time).
const ASSISTANT_TOOLS = [
  { apiName: 'searchAgent', arguments: '{"query":"device 2"}', identifier: 'lobehub-agent' },
  {
    apiName: 'assignTask',
    arguments: '{"taskId":"T199","deviceId":"cc-2"}',
    identifier: 'lobehub-task',
  },
];

const buildPendingSynthesis = (
  overrides: Partial<PendingSkillSynthesis> = {},
): PendingSkillSynthesis => ({
  agentId: 'agent_1',
  evidence: [
    { cue: 'requested correction / new action', excerpt: 'reusable task execution pattern' },
  ],
  message: USER_REQUEST,
  topicId: TOPIC_ID,
  ...overrides,
});

const buildParkedRecord = (
  pendingSynthesis: PendingSkillSynthesis | undefined,
): RecordedSkillIntent => ({
  createdAt: 1,
  explicitness: 'implicit_strong_learning',
  feedbackMessageId: USER_MESSAGE_ID,
  reason: 'a reusable task execution pattern',
  route: 'direct_decision',
  scopeKey: `topic:${TOPIC_ID}`,
  sourceId: USER_MESSAGE_ID,
  ...(pendingSynthesis ? { pendingSynthesis } : {}),
});

// db.query.messages.findMany feeds assembleTrajectoryContext; ordering mirrors
// the turn window (user request first, assistant product + tool calls last).
const trajectoryRows = [
  { content: USER_REQUEST, id: USER_MESSAGE_ID, role: 'user', tools: null },
  {
    content: 'T-199 已启动，初步 MVP 与报告已产出。',
    id: ASSISTANT_MESSAGE_ID,
    role: 'assistant',
    tools: ASSISTANT_TOOLS,
  },
];

// MessageModel.findById resolves through db.query.messages.findFirst; the handler
// walks assistant -> user parent, so the two calls return in that order.
const ASSISTANT_ROW = {
  content: 'T-199 已启动',
  createdAt: new Date(1000),
  id: ASSISTANT_MESSAGE_ID,
  parentId: USER_MESSAGE_ID,
  role: 'assistant',
  threadId: null,
};
const USER_ROW = {
  content: USER_REQUEST,
  createdAt: new Date(500),
  id: USER_MESSAGE_ID,
  parentId: null,
  role: 'user',
  threadId: null,
};

const createDb = () => {
  const findFirst = vi.fn().mockResolvedValueOnce(ASSISTANT_ROW).mockResolvedValueOnce(USER_ROW);
  const findMany = vi.fn().mockResolvedValue(trajectoryRows);
  return { db: { query: { messages: { findFirst, findMany } } } as never, findFirst, findMany };
};

const createContext = (applied = false): RuntimeProcessorContext =>
  ({
    now: () => 1,
    runtimeState: {
      getGuardState: vi.fn().mockResolvedValue(applied ? { lastEventAt: 1 } : {}),
      touchGuardState: vi.fn().mockResolvedValue({}),
    },
    scopeKey: `topic:${TOPIC_ID}`,
  }) as unknown as RuntimeProcessorContext;

// A normal, non-error, non-self-iteration completion for the user turn.
const createSource = (payloadOverrides: Record<string, unknown> = {}) =>
  ({
    payload: {
      agentId: 'agent_1',
      anchorMessageId: ASSISTANT_MESSAGE_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      operationId: 'op_run',
      steps: 3,
      topicId: TOPIC_ID,
      ...payloadOverrides,
    },
    sourceId: 'src_completed',
    sourceType: 'agent.execution.completed',
    timestamp: 1,
  }) as never;

interface HarnessOptions {
  pendingSynthesis?: PendingSkillSynthesis | undefined;
  recordOverride?: RecordedSkillIntent | undefined | null;
  selfIterationEnabled?: boolean;
}

const createHarness = (opts: HarnessOptions = {}) => {
  const { selfIterationEnabled = true } = opts;
  const record =
    opts.recordOverride === undefined
      ? buildParkedRecord(opts.pendingSynthesis ?? buildPendingSynthesis())
      : (opts.recordOverride ?? undefined);

  const read = vi.fn().mockResolvedValue(record);
  const write = vi.fn().mockResolvedValue(undefined);
  const dispatch = vi.fn().mockResolvedValue({ operationId: 'op_skill', topicId: TOPIC_ID });
  const { db, findFirst, findMany } = createDb();

  const handler = createCompletionSkillSynthesisSourceHandler({
    db,
    dispatch,
    procedureState: { skillIntentRecords: { read, write } as never },
    selfIterationEnabled,
    userId: 'user_1',
  });

  return { dispatch, findFirst, findMany, handler, read, write };
};

describe('createCompletionSkillSynthesisSourceHandler', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('listens on agent.execution.completed', () => {
    const { handler } = createHarness();
    expect(handler.listen).toBe('agent.execution.completed');
    expect(handler.type).toBe('source');
  });

  it('synthesizes the parked candidate off the completed-turn trajectory and anchors to the assistant turn', async () => {
    const { dispatch, handler, write } = createHarness();

    await handler.handle(createSource(), createContext());

    expect(dispatch).toHaveBeenCalledTimes(1);
    const dispatched = dispatch.mock.calls[0][0];

    // Acceptance: the seed anchors to the completed assistant turn, not the user
    // message — so it is not a floating `parent_id=null` mainline root.
    expect(dispatched.marker.anchorMessageId).toBe(ASSISTANT_MESSAGE_ID);
    expect(dispatched.sourceMessageId).toBe(ASSISTANT_MESSAGE_ID);
    expect(dispatched.marker.triggerMessageId).toBe(USER_MESSAGE_ID);

    // Acceptance: the synthesis prompt carries the tool sequence + final product
    // (trajectory), not just the user prompt.
    expect(dispatched.prompt).toContain(USER_REQUEST);
    expect(dispatched.prompt).toContain('lobehub-task.assignTask');
    expect(dispatched.prompt).toContain('lobehub-agent.searchAgent');
    expect(dispatched.prompt).toContain('completion_trajectory');
    expect(dispatched.prompt).toContain('<turn_trajectory>');

    // Acceptance: the parked candidate is consumed exactly once on a genuine
    // dispatch so a duplicate completion cannot re-synthesize.
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ feedbackMessageId: USER_MESSAGE_ID, pendingSynthesis: undefined }),
    );
  });

  it('does not re-synthesize when the action already applied (idempotency)', async () => {
    const { dispatch, handler, write } = createHarness();

    // Guard reports the action already applied — a duplicate completion (retry).
    await handler.handle(createSource(), createContext(true));

    expect(dispatch).not.toHaveBeenCalled();
    // A skipped (already-applied) attempt must not consume the candidate again.
    expect(write).not.toHaveBeenCalled();
  });

  it('is a no-op when no candidate was parked', async () => {
    const { dispatch, handler, write } = createHarness({ recordOverride: null });

    await handler.handle(createSource(), createContext());

    expect(dispatch).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('is a no-op when the parked record carries no synthesis payload', async () => {
    const { dispatch, handler } = createHarness({
      recordOverride: buildParkedRecord(undefined),
    });

    await handler.handle(createSource(), createContext());

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('skips self-iteration completions without reading the candidate', async () => {
    const { dispatch, findFirst, handler, read } = createHarness();

    await handler.handle(createSource({ selfIteration: { kind: 'skill' } }), createContext());

    expect(read).not.toHaveBeenCalled();
    // Returns before hydrating the turn — no message reads, no dispatch.
    expect(findFirst).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('is a no-op when self-iteration is disabled', async () => {
    const { dispatch, handler, read } = createHarness({ selfIterationEnabled: false });

    await handler.handle(createSource(), createContext());

    expect(read).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  // `agent.execution.completed` is reused for non-terminal pauses — the turn's
  // final assistant product doesn't exist yet, so the handler must not read or
  // consume the parked candidate (the later real completion does the synthesis).
  it.each(['waiting_for_async_tool', 'waiting_for_human'])(
    'skips the non-terminal park completion %s without consuming the candidate',
    async (reason) => {
      const { dispatch, findFirst, handler, read } = createHarness();

      await handler.handle(createSource({ reason }), createContext());

      expect(read).not.toHaveBeenCalled();
      expect(findFirst).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
    },
  );
});

/**
 * End-to-end across the seam the LOBE-10802 bug lived in: emit the completion
 * event from a *server execAgent* state whose operation metadata carries NO
 * per-turn `assistantMessageId` (DB shape: `{}` + agentId/topicId/userId), then
 * feed the emitted payload straight into the completion-skill-synthesis handler.
 *
 * The whole logic chain runs in-process — no QStash, no HTTP. The earlier
 * handler tests hardcoded `assistantMessageId` in `createSource()`, which masked
 * this gap; here the anchor is whatever `CompletionLifecycle.emitSignalEvents`
 * actually produces, so a regression in the resolution breaks the dispatch.
 */
describe('completion skill synthesis end-to-end (emit -> handler, no operation-metadata anchor)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Run the real emit path over a server-turn state and return the emitted
  // `agent.execution.completed` payload (the contract the handler consumes).
  const emitCompletedPayload = async (messages: unknown[]) => {
    const captured: Array<{ payload?: any; sourceType?: string }> = [];
    vi.spyOn(agentSignalService, 'emitAgentSignalSourceEvent').mockImplementation((async (
      emission: any,
    ) => {
      captured.push(emission);
      return undefined;
    }) as never);

    const lifecycle = new CompletionLifecycle({} as never, 'user_1');
    await lifecycle.emitSignalEvents(
      'op_run',
      {
        messages,
        // Operation-level metadata only — no per-turn assistantMessageId, exactly
        // as a server execAgent turn persists it.
        metadata: { agentId: 'agent_1', topicId: TOPIC_ID, userId: 'user_1' },
        stepCount: 3,
        status: 'done',
      },
      'done',
    );

    return captured.find((e) => e.sourceType === 'agent.execution.completed')?.payload;
  };

  const sourceFromPayload = (payload: unknown) =>
    ({
      payload,
      sourceId: 'op_run:complete:done',
      sourceType: 'agent.execution.completed',
      timestamp: 1,
    }) as never;

  it('resolves the anchor from the assistant row and drives the handler to dispatch + consume', async () => {
    const payload = await emitCompletedPayload([
      { content: USER_REQUEST, id: USER_MESSAGE_ID, role: 'user' },
      { content: 'T-199 已启动', id: ASSISTANT_MESSAGE_ID, role: 'assistant' },
    ]);

    // The fix: the completion event carries the resolved assistant anchor even
    // though operation metadata never held it.
    expect(payload.assistantMessageId).toBe(ASSISTANT_MESSAGE_ID);
    expect(payload.anchorMessageId).toBe(ASSISTANT_MESSAGE_ID);

    // Feed the emitted payload through the real handler — the orchestration seam.
    const { dispatch, handler, write } = createHarness();
    await handler.handle(sourceFromPayload(payload), createContext());

    expect(dispatch).toHaveBeenCalledTimes(1);
    const dispatched = dispatch.mock.calls[0][0];
    expect(dispatched.marker.anchorMessageId).toBe(ASSISTANT_MESSAGE_ID);
    expect(dispatched.sourceMessageId).toBe(ASSISTANT_MESSAGE_ID);
    expect(dispatched.prompt).toContain('<turn_trajectory>');
    expect(dispatched.prompt).toContain('lobehub-task.assignTask');
    // The parked candidate is consumed so a duplicate completion cannot re-run.
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ feedbackMessageId: USER_MESSAGE_ID, pendingSynthesis: undefined }),
    );
  });

  it('pre-fix shape (no assistant turn, no metadata anchor) emits an undefined anchor and the handler no-ops', async () => {
    // Reproduces the blocking defect's signal: with no assistant turn in state
    // and none on metadata, the completion event ships no anchor at all.
    const payload = await emitCompletedPayload([
      { content: USER_REQUEST, id: USER_MESSAGE_ID, role: 'user' },
    ]);

    expect(payload.assistantMessageId).toBeUndefined();

    const { dispatch, handler } = createHarness();
    await handler.handle(sourceFromPayload(payload), createContext());

    // The handler gates on the missing anchor — exactly the live Layer-4 no-op.
    expect(dispatch).not.toHaveBeenCalled();
  });
});
