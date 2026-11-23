import { describe, expect, it, vi } from 'vitest';

import { COLLABORATION_MODE_PHASE } from '../codexPlanMode';
import { CodexThreadSession } from './CodexThreadSession';

const THREAD = 'thread-1';

const turn = (id: string, status: 'completed' | 'inProgress' | 'interrupted') => ({
  completedAt: status === 'inProgress' ? null : 2,
  durationMs: null,
  error: null,
  id,
  items: [],
  itemsView: 'full',
  startedAt: 1,
  status,
});

/**
 * A Codex app-server stand-in that behaves like codex-cli 0.169.0 (probed):
 * `turn/start` with a collaboration mode first reports it with
 * `thread/settings/updated`, and a plan turn streams a `plan` item.
 */
const createHarness = (
  options: { hangTurns?: boolean; refuseMode?: boolean; slowAck?: boolean } = {},
) => {
  let notify: (method: string, params: unknown) => Promise<void> = async () => {};
  let threadMode: 'default' | 'plan' = 'default';
  let turnSequence = 0;
  const requests: Array<{ method: string; params: any }> = [];

  const settingsUpdated = (mode: 'default' | 'plan') =>
    notify('thread/settings/updated', {
      threadId: THREAD,
      threadSettings: {
        collaborationMode: {
          mode,
          settings: { developer_instructions: 'x', model: 'gpt-6.1-sol', reasoning_effort: 'high' },
        },
      },
    });

  const settledUpdated = (mode: 'default' | 'plan') => settingsUpdated(mode);

  const client = {
    acquireConsumer: vi.fn(() => vi.fn()),
    acquireThread: vi.fn(() => vi.fn()),
    connect: vi.fn().mockResolvedValue({ userAgent: 'codex-test' }),
    onDisconnect: vi.fn(() => vi.fn()),
    onRawMessage: vi.fn(() => vi.fn()),
    registerThread: vi.fn(() => vi.fn()),
    request: vi.fn(async (method: string, params: any) => {
      requests.push({ method, params });
      if (method === 'thread/start') {
        return { model: 'gpt-6.1-sol', reasoningEffort: 'high', thread: { id: THREAD } };
      }
      if (method === 'thread/name/set') return {};
      if (method === 'thread/settings/update') {
        if (threadMode !== params.collaborationMode.mode) {
          threadMode = params.collaborationMode.mode;
          const ack = threadMode;
          // `slowAck`: Codex answers after the caller already moved on.
          if (options.slowAck) setTimeout(() => void settingsUpdated(ack), 5);
          else void settingsUpdated(ack);
        }
        return {};
      }
      if (method === 'turn/interrupt') {
        setTimeout(() => {
          void notify('turn/completed', {
            threadId: THREAD,
            turn: turn(params.turnId, 'interrupted'),
          });
        }, 0);
        return {};
      }
      if (method === 'turn/start') {
        const turnId = `turn-${++turnSequence}`;
        // `refuseMode`: Codex keeps the thread where it was and says so.
        const mode = options.refuseMode ? undefined : params.collaborationMode?.mode;
        if (options.refuseMode && params.collaborationMode) await settledUpdated(threadMode);
        if (mode && mode !== threadMode) {
          threadMode = mode;
          await settingsUpdated(mode);
        }
        if (!options.hangTurns) {
          setTimeout(async () => {
            await notify('turn/started', { threadId: THREAD, turn: turn(turnId, 'inProgress') });
            if (threadMode === 'plan') {
              const item = { id: `plan-${turnId}`, text: '', type: 'plan' };
              await notify('item/started', { item, threadId: THREAD, turnId });
              await notify('item/plan/delta', {
                delta: '1. Step',
                itemId: item.id,
                threadId: THREAD,
                turnId,
              });
              await notify('item/completed', {
                item: { ...item, text: '1. Step\n' },
                threadId: THREAD,
                turnId,
              });
            }
            await notify('turn/completed', { threadId: THREAD, turn: turn(turnId, 'completed') });
          }, 0);
        }
        return { turn: turn(turnId, 'inProgress') };
      }
      return {};
    }),
    subscribe: vi.fn((_threadId: string, handler: typeof notify) => {
      notify = handler;
      return vi.fn();
    }),
    subscribeServerRequests: vi.fn(() => vi.fn()),
  };

  const events: any[] = [];
  const session = new CodexThreadSession({
    client: client as any,
    onEvents: (batch) => void events.push(...batch),
    onRuntimeStatus: vi.fn(),
    onSessionId: vi.fn(),
    sessionId: 'session-1',
    threadParams: { approvalPolicy: 'never', cwd: '/repo', sandbox: 'danger-full-access' },
  });
  const reports = () => events.filter((e) => e.data?.phase === COLLABORATION_MODE_PHASE);
  const turnStarts = () => requests.filter((r) => r.method === 'turn/start').map((r) => r.params);
  const settingsUpdates = () =>
    requests
      .filter((r) => r.method === 'thread/settings/update')
      .map((r) => r.params.collaborationMode.mode);
  return {
    events,
    reports,
    requests,
    session,
    settingsUpdates,
    threadMode: () => threadMode,
    turnStarts,
  };
};

const runOnce = (
  session: CodexThreadSession,
  options: Partial<Parameters<CodexThreadSession['run']>[0]> = {},
) =>
  session.run({
    input: [{ text: 'hi', text_elements: [], type: 'text' }],
    onRawMessage: vi.fn(),
    operationId: 'op-1',
    ...options,
  });

describe('CodexThreadSession — Codex Plan switch', () => {
  it('sends no collaboration mode and reports nothing for a topic that never used Plan', async () => {
    const harness = createHarness();

    await runOnce(harness.session);

    expect(harness.turnStarts()[0]).not.toHaveProperty('collaborationMode');
    expect(harness.settingsUpdates()).toEqual([]);
    expect(harness.reports()).toEqual([]);
  });

  it('sends plan with the thread model and effort, and the thread stays in plan', async () => {
    const harness = createHarness();

    await runOnce(harness.session, { collaborationMode: 'plan' });

    expect(harness.turnStarts()[0].collaborationMode).toEqual({
      mode: 'plan',
      settings: { developer_instructions: null, model: 'gpt-6.1-sol', reasoning_effort: 'high' },
    });
    // Plan is sticky: nothing puts the thread back once the turn ends.
    expect(harness.settingsUpdates()).toEqual([]);
    expect(harness.threadMode()).toBe('plan');
    // The read-back after `turn/start` confirms the request: nothing to sync.
    expect(harness.reports().map((e) => e.data)).toEqual([
      { collaborationMode: 'plan', phase: COLLABORATION_MODE_PHASE, requested: 'plan' },
    ]);
    // The plan item reaches the transcript as a `proposed_plan` tool.
    expect(
      harness.events.some((e) => e.type === 'tool_result' && e.data.content === '1. Step\n'),
    ).toBe(true);
  });

  it('sends the current mode on every turn once Plan was used, so turning it off takes effect', async () => {
    const harness = createHarness();

    await runOnce(harness.session, { collaborationMode: 'plan' });
    await runOnce(harness.session, { collaborationMode: 'plan' });
    await runOnce(harness.session, { collaborationMode: 'default' });

    expect(harness.turnStarts().map((p) => p.collaborationMode.mode)).toEqual([
      'plan',
      'plan',
      'default',
    ]);
    expect(harness.threadMode()).toBe('default');
    // Only changes are reported: on, then off.
    expect(harness.reports().map((e) => e.data.collaborationMode)).toEqual(['plan', 'default']);
  });

  it('leaves the thread in plan when the user stops a plan turn', async () => {
    const harness = createHarness({ hangTurns: true });
    const run = runOnce(harness.session, { collaborationMode: 'plan' });
    await vi.waitFor(() => expect(harness.turnStarts()).toHaveLength(1));

    await harness.session.interrupt();
    await run;

    expect(harness.settingsUpdates()).toEqual([]);
    expect(harness.threadMode()).toBe('plan');
  });

  it('switches mid-run from the next turn, never the turn in flight', async () => {
    const harness = createHarness({ hangTurns: true });
    const run = runOnce(harness.session, { collaborationMode: 'default' });
    await vi.waitFor(() => expect(harness.turnStarts()).toHaveLength(1));

    await harness.session.setCollaborationMode('plan');

    expect(harness.settingsUpdates()).toEqual(['plan']);
    expect(harness.turnStarts()).toHaveLength(1);
    expect(harness.reports().at(-1)?.data).toEqual({
      collaborationMode: 'plan',
      phase: COLLABORATION_MODE_PHASE,
      requested: 'plan',
    });
    await harness.session.interrupt();
    await run;
  });

  it('reports what Codex says when it does not take the requested mode', async () => {
    const harness = createHarness({ refuseMode: true });

    await runOnce(harness.session, { collaborationMode: 'plan' });

    expect(harness.reports().map((e) => e.data)).toEqual([
      { collaborationMode: 'default', phase: COLLABORATION_MODE_PHASE, requested: 'plan' },
    ]);
  });

  it('reads an acknowledgement of an earlier flip as that flip, not a refusal of the latest', async () => {
    const harness = createHarness({ hangTurns: true, slowAck: true });
    const run = runOnce(harness.session, { collaborationMode: 'default' });
    await vi.waitFor(() => expect(harness.turnStarts()).toHaveLength(1));

    // On then off before Codex answers the first switch.
    await harness.session.setCollaborationMode('plan');
    await harness.session.setCollaborationMode('default');
    await vi.waitFor(() => expect(harness.reports()).toHaveLength(2));

    const reports = harness.reports().map((e) => e.data);
    expect(reports).toEqual([
      { collaborationMode: 'plan', phase: COLLABORATION_MODE_PHASE, requested: 'plan' },
      { collaborationMode: 'default', phase: COLLABORATION_MODE_PHASE, requested: 'default' },
    ]);
    // Neither report disagrees with its request, so the topic keeps the user's last pick.
    expect(reports.every((r) => r.collaborationMode === r.requested)).toBe(true);
    await harness.session.interrupt();
    await run;
  });
});
