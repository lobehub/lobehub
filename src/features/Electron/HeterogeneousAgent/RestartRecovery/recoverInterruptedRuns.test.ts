import { HETERO_RESTART_CONTINUE_PROMPT } from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { recoverInterruptedHeteroRuns } from './recoverInterruptedRuns';

const mockListInterruptedRuns = vi.fn();
const mockProbeTranscriptReplay = vi.fn();
const mockReleaseInterruptedRun = vi.fn(async (..._args: unknown[]) => {});
vi.mock('@/services/electron/heterogeneousAgent', () => ({
  heterogeneousAgentService: {
    listInterruptedRuns: (...args: unknown[]) => mockListInterruptedRuns(...args),
    probeTranscriptReplay: (...args: unknown[]) => mockProbeTranscriptReplay(...args),
    releaseInterruptedRun: (...args: unknown[]) => mockReleaseInterruptedRun(...args),
  },
}));

const mockGetTopicDetail = vi.fn();
vi.mock('@/services/topic', () => ({
  topicService: { getTopicDetail: (...args: unknown[]) => mockGetTopicDetail(...args) },
}));

const mockGetMessages = vi.fn();
const mockRemoveMessages = vi.fn();
vi.mock('@/services/message', () => ({
  messageService: {
    getMessages: (...args: unknown[]) => mockGetMessages(...args),
    removeMessages: (...args: unknown[]) => mockRemoveMessages(...args),
  },
}));

const mockGetAgentConfigById = vi.fn();
vi.mock('@/services/agent', () => ({
  agentService: { getAgentConfigById: (...args: unknown[]) => mockGetAgentConfigById(...args) },
}));

const mockRunHetero = vi.fn();
const mockEnsureAccess = vi.fn(async (..._args: unknown[]) => {});
const mockGetAgencyConfig = vi.fn();
const mockResolveRunContext = vi.fn();
vi.mock('@/features/Conversation/store/slices/generation/action', () => ({
  ensureEffectiveAgencyAccess: (...args: unknown[]) => mockEnsureAccess(...args),
  getEffectiveAgencyConfig: (...args: unknown[]) => mockGetAgencyConfig(...args),
  resolveHeteroRunContext: (...args: unknown[]) => mockResolveRunContext(...args),
  runHeterogeneousFromExistingMessage: (...args: unknown[]) => mockRunHetero(...args),
}));

const agentState = { agentMap: {} as Record<string, any> };
const mockAgentSetState = vi.fn((...args: any[]) => {
  const updater = args[0];
  Object.assign(agentState, typeof updater === 'function' ? updater(agentState) : updater);
});
vi.mock('@/store/agent', () => ({
  useAgentStore: {
    getState: () => agentState,
    setState: (...args: unknown[]) => mockAgentSetState(...args),
  },
}));

const chatStore = {
  completeOperation: vi.fn(),
  failOperation: vi.fn(),
  refreshMessages: vi.fn(async (..._args: unknown[]) => {}),
  replaceMessages: vi.fn(),
  startOperation: vi.fn(() => ({ operationId: 'wrap-op' })),
  updateTopicMetadata: vi.fn(async (..._args: unknown[]) => {}),
  updateTopicStatus: vi.fn(async () => {}),
};
vi.mock('@/store/chat', () => ({
  useChatStore: { getState: () => chatStore },
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => 'ws-1',
}));

vi.mock('@/store/user', () => ({ getUserStoreState: () => ({}) }));
vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { userId: () => 'user-1' },
}));

const provider = { command: 'claude', type: 'claude-code' as const };
const run = {
  agentId: 'agent-1',
  agentType: 'claude-code',
  ipcSessionId: 'ipc-1',
  operationId: 'op-1',
  startedAt: '2026-09-21T02:00:00.000Z',
  topicId: 'topic-1',
};
const topic = {
  id: 'topic-1',
  metadata: { heteroSessionIdByWorkingDirectory: { '/repo': 'cc-1' }, workingDirectory: '/repo' },
  status: 'running',
};
const messages = [
  { content: 'earlier', createdAt: 100, id: 'u0', role: 'user' },
  { content: 'earlier answer', createdAt: 110, id: 'a0', parentId: 'u0', role: 'assistant' },
  { content: 'do the thing', createdAt: 200, id: 'u1', role: 'user' },
  { content: 'partial', createdAt: 210, id: 'a1', parentId: 'u1', role: 'assistant' },
  { content: '', createdAt: 220, id: 't1', parentId: 'a1', role: 'tool' },
  // subagent thread rows are not touched
  { content: 'sub', createdAt: 230, id: 's1', role: 'assistant', threadId: 'thread-1' },
];

describe('recoverInterruptedHeteroRuns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentState.agentMap = {};
    mockListInterruptedRuns.mockResolvedValue([run]);
    mockGetTopicDetail.mockResolvedValue(topic);
    mockProbeTranscriptReplay.mockResolvedValue({ available: true, complete: true });
    mockGetMessages.mockResolvedValue(messages);
    mockGetAgentConfigById.mockResolvedValue({
      agencyConfig: { heterogeneousProvider: provider },
      id: 'agent-1',
    });
    mockGetAgencyConfig.mockReturnValue({
      agencyConfig: { heterogeneousProvider: provider },
    });
    // Mirror the real resolver: it reads the (possibly just-patched) topic.
    mockResolveRunContext.mockImplementation((...args: any[]) => {
      const topicArg = args[3];
      const cwd = topicArg?.metadata?.workingDirectory ?? '/repo';
      return {
        cwdChanged: false,
        resumeSessionId: topicArg?.metadata?.heteroSessionIdByWorkingDirectory?.[cwd],
        workingDirectory: cwd,
      };
    });
  });

  it('asks main only for runs of the user and workspace it is in', async () => {
    // Topic reads are scoped to both, so a run recorded elsewhere must stay on
    // the ledger rather than resolve as a missing topic and be consumed.
    mockListInterruptedRuns.mockResolvedValue([]);

    await recoverInterruptedHeteroRuns();

    expect(mockListInterruptedRuns).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: 'ws-1',
    });
  });

  it('does nothing when the ledger is empty', async () => {
    mockListInterruptedRuns.mockResolvedValue([]);

    expect(await recoverInterruptedHeteroRuns()).toEqual([]);
    expect(mockGetTopicDetail).not.toHaveBeenCalled();
  });

  it('replaces the interrupted turn with a transcript replay and stops when the turn finished', async () => {
    mockRunHetero.mockResolvedValue({ assistantMessageId: 'a-new', replayComplete: true });

    const results = await recoverInterruptedHeteroRuns();

    expect(results).toEqual([{ outcome: 'replayed', topicId: 'topic-1' }]);
    // Cold agent store: the config is fetched and seeded before reading agency config.
    expect(mockGetAgentConfigById).toHaveBeenCalledWith('agent-1');
    expect(agentState.agentMap['agent-1']).toBeDefined();
    expect(mockEnsureAccess).toHaveBeenCalledWith('agent-1');
    // The transcript is probed with the topic's own resume identity first.
    expect(mockProbeTranscriptReplay).toHaveBeenCalledWith({
      agentType: 'claude-code',
      configDir: undefined,
      cwd: '/repo',
      // Pins the transcript's last turn to the prompt this run was given.
      expectedPrompt: 'do the thing',
      notBefore: run.startedAt,
      sessionId: 'cc-1',
    });
    // The probe identity comes from the resolver the run itself uses.
    expect(mockResolveRunContext).toHaveBeenCalled();
    expect(chatStore.updateTopicMetadata).not.toHaveBeenCalled();
    // Only the interrupted turn's own rows go; earlier turns and thread rows stay.
    expect(mockRemoveMessages).toHaveBeenCalledWith(['a1', 't1'], {
      agentId: 'agent-1',
      topicId: 'topic-1',
    });
    // The surviving rows are seeded into the store before the run, so the user
    // turn renders while the topic's own fetch is gated off by the running op.
    expect(chatStore.replaceMessages).toHaveBeenCalledWith(
      messages.filter((m) => m.id !== 'a1' && m.id !== 't1'),
      { action: 'restartRecovery', context: { agentId: 'agent-1', topicId: 'topic-1' } },
    );
    expect(chatStore.refreshMessages).toHaveBeenCalledWith({
      agentId: 'agent-1',
      topicId: 'topic-1',
    });
    expect(mockRunHetero).toHaveBeenCalledTimes(1);
    expect(mockRunHetero).toHaveBeenCalledWith(
      chatStore,
      expect.objectContaining({
        context: { agentId: 'agent-1', topicId: 'topic-1' },
        heterogeneousProvider: provider,
        parentMessageId: 'u1',
        parentOperationId: 'wrap-op',
        prompt: 'do the thing',
        replayTranscript: true,
        // The probe and the replay must read the SAME profile the run used.
        replayTranscriptConfigDir: undefined,
        topic,
      }),
    );
    expect(chatStore.completeOperation).toHaveBeenCalledWith('wrap-op');
  });

  it('chains a --resume continuation onto the replayed tail when the turn was cut off', async () => {
    mockRunHetero
      .mockResolvedValueOnce({ assistantMessageId: 'a-new', replayComplete: false })
      .mockResolvedValueOnce({ assistantMessageId: 'a-cont' });
    mockGetMessages
      .mockResolvedValueOnce(messages)
      .mockResolvedValueOnce([
        ...messages.slice(0, 3),
        { content: 'replayed', createdAt: 300, id: 'a-new', parentId: 'u1', role: 'assistant' },
        { content: '', createdAt: 310, id: 't-new', parentId: 'a-new', role: 'tool' },
      ]);

    const results = await recoverInterruptedHeteroRuns();

    expect(results).toEqual([{ outcome: 'resumed', topicId: 'topic-1' }]);
    expect(mockRunHetero).toHaveBeenCalledTimes(2);
    expect(mockRunHetero.mock.calls[1][1]).toMatchObject({
      parentMessageId: 'a-new',
      prompt: HETERO_RESTART_CONTINUE_PROMPT,
      topic,
    });
    expect(mockRunHetero.mock.calls[1][1].replayTranscript).toBeUndefined();
    expect(chatStore.completeOperation).toHaveBeenCalledWith('wrap-op');
  });

  it('leaves a topic alone that is no longer running', async () => {
    mockGetTopicDetail.mockResolvedValue({ ...topic, status: 'active' });

    const results = await recoverInterruptedHeteroRuns();

    expect(results).toEqual([{ outcome: 'skipped', reason: 'not-running', topicId: 'topic-1' }]);
    expect(mockRemoveMessages).not.toHaveBeenCalled();
    expect(mockRunHetero).not.toHaveBeenCalled();
    expect(chatStore.updateTopicStatus).not.toHaveBeenCalled();
  });

  it('settles an unsupported run back to active without touching its rows', async () => {
    mockListInterruptedRuns.mockResolvedValue([{ ...run, agentType: 'codex' }]);

    const results = await recoverInterruptedHeteroRuns();

    expect(results).toEqual([
      { outcome: 'skipped', reason: 'unsupported-run', topicId: 'topic-1' },
    ]);
    expect(chatStore.updateTopicStatus).toHaveBeenCalledWith({
      agentId: 'agent-1',
      status: 'active',
      topicId: 'topic-1',
    });
    expect(mockRemoveMessages).not.toHaveBeenCalled();
  });

  it('fails the wrapper operation and keeps going when a replay throws', async () => {
    mockListInterruptedRuns.mockResolvedValue([
      run,
      { ...run, ipcSessionId: 'ipc-2', topicId: 'topic-2' },
    ]);
    mockGetTopicDetail.mockImplementation(async (id: string) => ({ ...topic, id }));
    mockRunHetero
      .mockRejectedValueOnce(new Error('no transcript'))
      .mockResolvedValueOnce({ assistantMessageId: 'a-new', replayComplete: true });

    const results = await recoverInterruptedHeteroRuns();

    expect(results).toEqual([
      { outcome: 'failed', reason: 'no transcript', topicId: 'topic-1' },
      { outcome: 'replayed', topicId: 'topic-2' },
    ]);
    expect(chatStore.failOperation).toHaveBeenCalledWith('wrap-op', {
      message: 'no transcript',
      type: 'RestartRecoveryError',
    });
  });

  it('keeps the persisted rows and settles the topic when no transcript can be replayed', async () => {
    mockProbeTranscriptReplay.mockResolvedValue({ available: false, reason: 'gone' });

    const results = await recoverInterruptedHeteroRuns();

    expect(results).toEqual([
      { outcome: 'skipped', reason: 'no-transcript: gone', topicId: 'topic-1' },
    ]);
    expect(mockRemoveMessages).not.toHaveBeenCalled();
    expect(mockRunHetero).not.toHaveBeenCalled();
    expect(chatStore.updateTopicStatus).toHaveBeenCalledWith({
      agentId: 'agent-1',
      status: 'active',
      topicId: 'topic-1',
    });
  });

  it('restores the resume metadata from the ledger when the topic write was lost', async () => {
    mockListInterruptedRuns.mockResolvedValue([
      {
        ...run,
        agentSessionId: 'cc-from-ledger',
        bindingKey: 'provider:openai-compatible#1',
        configDir: '/profile',
        cwd: '/repo',
      },
    ]);
    mockGetTopicDetail.mockResolvedValue({ ...topic, metadata: { workingDirectory: '/repo' } });
    mockRunHetero.mockResolvedValue({ assistantMessageId: 'a-new', replayComplete: true });

    const results = await recoverInterruptedHeteroRuns();

    expect(results).toEqual([{ outcome: 'replayed', topicId: 'topic-1' }]);
    // The binding key travels with the session id: main drops a provider-bound
    // resume whose key does not match the binding it resolves, and the replay
    // then has no session to read.
    expect(chatStore.updateTopicMetadata).toHaveBeenCalledWith('topic-1', {
      heteroSessionBindingKey: 'provider:openai-compatible#1',
      heteroSessionBindingKeyByWorkingDirectory: { '/repo': 'provider:openai-compatible#1' },
      heteroSessionId: 'cc-from-ledger',
      heteroSessionIdByWorkingDirectory: { '/repo': 'cc-from-ledger' },
      workingDirectory: '/repo',
    });
    expect(mockProbeTranscriptReplay).toHaveBeenCalledWith({
      agentType: 'claude-code',
      configDir: '/profile',
      cwd: '/repo',
      expectedPrompt: 'do the thing',
      notBefore: run.startedAt,
      sessionId: 'cc-from-ledger',
    });
    // The run itself sees the patched topic so resume resolves from it, and the
    // replay reads the profile the interrupted run actually wrote under.
    expect(mockRunHetero.mock.calls[0][1].topic.metadata).toMatchObject({
      heteroSessionIdByWorkingDirectory: { '/repo': 'cc-from-ledger' },
    });
    expect(mockRunHetero.mock.calls[0][1].replayTranscriptConfigDir).toBe('/profile');
  });

  it('settles a topic still marked running when the replay throws before the executor owns it', async () => {
    mockRunHetero.mockRejectedValueOnce(new Error('createMessage failed'));

    const results = await recoverInterruptedHeteroRuns();

    expect(results).toEqual([
      { outcome: 'failed', reason: 'createMessage failed', topicId: 'topic-1' },
    ]);
    expect(chatStore.updateTopicStatus).toHaveBeenCalledWith({
      agentId: 'agent-1',
      status: 'active',
      topicId: 'topic-1',
    });
  });

  it('leaves the status alone when the executor already wrote its own terminal state', async () => {
    mockRunHetero.mockRejectedValueOnce(new Error('cli exit 1'));
    mockGetTopicDetail
      .mockResolvedValueOnce(topic)
      .mockResolvedValueOnce({ ...topic, status: 'failed' });

    await recoverInterruptedHeteroRuns();

    expect(chatStore.updateTopicStatus).not.toHaveBeenCalled();
  });

  it('recovers a topic left awaiting human input', async () => {
    // AskUserQuestion parks the topic as waitingForHuman; the restart killed
    // the CLI and its intervention bridge, and the stale-topic watchdog only
    // looks at `running`, so nothing else would ever reset it.
    mockGetTopicDetail.mockResolvedValue({ ...topic, status: 'waitingForHuman' });
    mockProbeTranscriptReplay.mockResolvedValue({ available: true, complete: false });
    mockRunHetero
      .mockResolvedValueOnce({ assistantMessageId: 'a-new', replayComplete: false })
      .mockResolvedValueOnce({ assistantMessageId: 'a-cont' });

    const results = await recoverInterruptedHeteroRuns();

    expect(results).toEqual([{ outcome: 'resumed', topicId: 'topic-1' }]);
    expect(mockRunHetero).toHaveBeenCalledTimes(2);
  });

  it('settles a stranded waitingForHuman topic when the replay cannot run', async () => {
    mockGetTopicDetail.mockResolvedValue({ ...topic, status: 'waitingForHuman' });
    mockProbeTranscriptReplay.mockResolvedValue({ available: false, reason: 'gone' });

    const results = await recoverInterruptedHeteroRuns();

    expect(results).toEqual([
      { outcome: 'skipped', reason: 'no-transcript: gone', topicId: 'topic-1' },
    ]);
    expect(chatStore.updateTopicStatus).toHaveBeenCalledWith({
      agentId: 'agent-1',
      status: 'active',
      topicId: 'topic-1',
    });
  });

  it("deletes only the interrupted run's own branch, keeping earlier answers", async () => {
    // A regenerated turn hangs several assistant branches off one user row.
    const withBranches = [
      ...messages.slice(0, 3),
      // an earlier, completed answer to the same user turn
      { content: 'first answer', createdAt: 205, id: 'a-old', parentId: 'u1', role: 'assistant' },
      { content: 'old tool', createdAt: 206, id: 't-old', parentId: 'a-old', role: 'tool' },
      // the interrupted run's own branch
      { content: 'partial', createdAt: 210, id: 'a1', parentId: 'u1', role: 'assistant' },
      { content: '', createdAt: 220, id: 't1', parentId: 'a1', role: 'tool' },
    ];
    mockListInterruptedRuns.mockResolvedValue([{ ...run, assistantMessageId: 'a1' }]);
    mockGetMessages.mockResolvedValue(withBranches);
    mockRunHetero.mockResolvedValue({ assistantMessageId: 'a-new', replayComplete: true });

    const results = await recoverInterruptedHeteroRuns();

    expect(results).toEqual([{ outcome: 'replayed', topicId: 'topic-1' }]);
    expect(mockRemoveMessages).toHaveBeenCalledWith(['a1', 't1'], {
      agentId: 'agent-1',
      topicId: 'topic-1',
    });
  });

  it('leaves the topic alone when another device added a newer assistant branch', async () => {
    // Regeneration elsewhere does not move the user row's timestamp, so only
    // the recorded assistant identity catches this takeover.
    mockListInterruptedRuns.mockResolvedValue([{ ...run, assistantMessageId: 'a1' }]);
    mockGetMessages.mockResolvedValue([
      ...messages,
      { content: 'newer run', createdAt: 900, id: 'a-newer', parentId: 'u1', role: 'assistant' },
    ]);

    const results = await recoverInterruptedHeteroRuns();

    expect(results).toEqual([
      { outcome: 'skipped', reason: 'topic-taken-over', topicId: 'topic-1' },
    ]);
    expect(mockRemoveMessages).not.toHaveBeenCalled();
    expect(chatStore.updateTopicStatus).not.toHaveBeenCalled();
  });

  it('does not report a failed continuation as resumed', async () => {
    // The executor persists a terminal error instead of throwing, so the call
    // resolving is not success — a toast saying the run was picked up would be
    // a lie when the CLI never started.
    mockRunHetero
      .mockResolvedValueOnce({ assistantMessageId: 'a-new', replayComplete: false })
      .mockResolvedValueOnce({ assistantMessageId: 'a-cont', terminalError: true });

    const results = await recoverInterruptedHeteroRuns();

    expect(results).toEqual([
      {
        outcome: 'failed',
        reason: 'Restart continuation ended on a terminal error',
        topicId: 'topic-1',
      },
    ]);
    expect(chatStore.completeOperation).not.toHaveBeenCalled();
  });

  it('does not resume when the replay reported no outcome', async () => {
    // The executor swallows a replay failure and returns nothing; resuming
    // would spend a real turn on top of a replay that never happened.
    mockRunHetero.mockResolvedValue({ assistantMessageId: 'a-new' });

    const results = await recoverInterruptedHeteroRuns();

    expect(results).toEqual([
      {
        outcome: 'failed',
        reason: 'Transcript replay reported no outcome',
        topicId: 'topic-1',
      },
    ]);
    expect(mockRunHetero).toHaveBeenCalledTimes(1);
    expect(chatStore.updateTopicStatus).toHaveBeenCalledWith({
      agentId: 'agent-1',
      status: 'active',
      topicId: 'topic-1',
    });
  });

  it('still recovers a topic the stale-run watchdog already flipped to active', async () => {
    // The watchdog's two-hour sweep only means nobody claimed the run; the
    // ledger entry proves it never settled, so the partial turn is still owed
    // a replay.
    mockListInterruptedRuns.mockResolvedValue([{ ...run, assistantMessageId: 'a1' }]);
    mockGetTopicDetail.mockResolvedValue({ ...topic, status: 'active' });
    mockRunHetero.mockResolvedValue({ assistantMessageId: 'a-new', replayComplete: true });

    const results = await recoverInterruptedHeteroRuns();

    expect(results).toEqual([{ outcome: 'replayed', topicId: 'topic-1' }]);
    expect(mockRemoveMessages).toHaveBeenCalledWith(['a1', 't1'], {
      agentId: 'agent-1',
      topicId: 'topic-1',
    });
  });

  it('does not settle a topic another device took over, even when the probe fails', async () => {
    // Ownership is decided before any write: probing the other device's newer
    // session against our old profile fails, and settling on that would
    // clobber its live status.
    mockListInterruptedRuns.mockResolvedValue([{ ...run, assistantMessageId: 'a1' }]);
    mockGetMessages.mockResolvedValue([
      ...messages,
      { content: 'newer run', createdAt: 900, id: 'a-newer', parentId: 'u1', role: 'assistant' },
    ]);
    mockProbeTranscriptReplay.mockResolvedValue({ available: false, reason: 'gone' });

    const results = await recoverInterruptedHeteroRuns();

    expect(results).toEqual([
      { outcome: 'skipped', reason: 'topic-taken-over', topicId: 'topic-1' },
    ]);
    expect(chatStore.updateTopicStatus).not.toHaveBeenCalled();
    expect(chatStore.updateTopicMetadata).not.toHaveBeenCalled();
    expect(mockProbeTranscriptReplay).not.toHaveBeenCalled();
  });

  it('settles an expired run instead of replaying it', async () => {
    // Past the replay window the transcript is unusable, but a waitingForHuman
    // topic would otherwise stay parked forever — the watchdog only sees
    // `running`.
    mockListInterruptedRuns.mockResolvedValue([{ ...run, expired: true }]);
    mockGetTopicDetail.mockResolvedValue({ ...topic, status: 'waitingForHuman' });

    const results = await recoverInterruptedHeteroRuns();

    expect(results).toEqual([{ outcome: 'skipped', reason: 'expired', topicId: 'topic-1' }]);
    expect(chatStore.updateTopicStatus).toHaveBeenCalledWith({
      agentId: 'agent-1',
      status: 'active',
      topicId: 'topic-1',
    });
    expect(mockRunHetero).not.toHaveBeenCalled();
    expect(mockRemoveMessages).not.toHaveBeenCalled();
  });

  it('leaves a topic alone when a newer turn took it over while the app was down', async () => {
    // Another device started a turn after our run was spawned: its user row is
    // newer than the ledger entry. Touching it would delete that live run's
    // output, and settling would clobber its status.
    mockGetMessages.mockResolvedValue([
      ...messages,
      {
        content: 'newer turn',
        createdAt: Date.parse(run.startedAt) + 1000,
        id: 'u2',
        role: 'user',
      },
    ]);

    const results = await recoverInterruptedHeteroRuns();

    expect(results).toEqual([
      { outcome: 'skipped', reason: 'topic-taken-over', topicId: 'topic-1' },
    ]);
    expect(mockRemoveMessages).not.toHaveBeenCalled();
    expect(mockRunHetero).not.toHaveBeenCalled();
    expect(chatStore.updateTopicStatus).not.toHaveBeenCalled();
  });

  it('keeps the rows when the saved session cannot be resumed under the current binding', async () => {
    // The shared resolver rejects the session (auth binding changed while the
    // app was down); deleting rows first would lose the output for nothing.
    mockResolveRunContext.mockReturnValue({
      cwdChanged: false,
      reason: 'binding_changed',
      resumeSessionId: undefined,
      workingDirectory: '/repo',
    });

    const results = await recoverInterruptedHeteroRuns();

    expect(results).toEqual([
      { outcome: 'skipped', reason: 'resume-unavailable', topicId: 'topic-1' },
    ]);
    expect(mockProbeTranscriptReplay).not.toHaveBeenCalled();
    expect(mockRemoveMessages).not.toHaveBeenCalled();
    expect(chatStore.updateTopicStatus).toHaveBeenCalledWith({
      agentId: 'agent-1',
      status: 'active',
      topicId: 'topic-1',
    });
  });

  it('settles the topic when the pre-flight agent load fails', async () => {
    // The ledger entry is already consumed, so a throw here would otherwise
    // leave the topic spinning until the stale-topic watchdog runs.
    mockGetAgentConfigById.mockRejectedValue(new Error('network down'));

    const results = await recoverInterruptedHeteroRuns();

    expect(results).toEqual([{ outcome: 'failed', reason: 'network down', topicId: 'topic-1' }]);
    expect(chatStore.failOperation).not.toHaveBeenCalled();
    expect(chatStore.updateTopicStatus).toHaveBeenCalledWith({
      agentId: 'agent-1',
      status: 'active',
      topicId: 'topic-1',
    });
  });

  it('recovers each topic once even when the ledger holds duplicate entries', async () => {
    mockListInterruptedRuns.mockResolvedValue([run, { ...run, ipcSessionId: 'ipc-later' }]);
    mockRunHetero.mockResolvedValue({ assistantMessageId: 'a-new', replayComplete: true });

    const results = await recoverInterruptedHeteroRuns();

    expect(results).toHaveLength(1);
    expect(mockRunHetero).toHaveBeenCalledTimes(1);
    // The superseded entry is spent too, or it would be retried every launch.
    expect(mockReleaseInterruptedRun).toHaveBeenCalledWith('ipc-1');
    expect(mockReleaseInterruptedRun).toHaveBeenCalledWith('ipc-later');
  });

  it('restores a native binding key when the run had no hosted binding', async () => {
    mockListInterruptedRuns.mockResolvedValue([
      { ...run, agentSessionId: 'cc-from-ledger', cwd: '/repo' },
    ]);
    mockGetTopicDetail.mockResolvedValue({ ...topic, metadata: { workingDirectory: '/repo' } });
    mockRunHetero.mockResolvedValue({ assistantMessageId: 'a-new', replayComplete: true });

    await recoverInterruptedHeteroRuns();

    expect(chatStore.updateTopicMetadata).toHaveBeenCalledWith(
      'topic-1',
      expect.objectContaining({ heteroSessionBindingKey: 'native:v1:claude-code' }),
    );
  });

  it('probes with the prompt the CLI was actually given', async () => {
    // The executor strips the `/goal` command before sending, so the
    // transcript never holds the raw row content — probing with it would
    // reject the run's own turn as a different one.
    mockGetMessages.mockResolvedValue([
      ...messages.slice(0, 2),
      { content: '/goal ship the report', createdAt: 200, id: 'u1', role: 'user' },
      ...messages.slice(3),
    ]);
    mockRunHetero.mockResolvedValue({ assistantMessageId: 'a-new', replayComplete: true });

    await recoverInterruptedHeteroRuns();

    expect(mockProbeTranscriptReplay).toHaveBeenCalledWith(
      expect.objectContaining({ expectedPrompt: 'ship the report' }),
    );
  });

  it('releases the ledger entry once recovery has an outcome', async () => {
    mockRunHetero.mockResolvedValue({ assistantMessageId: 'a-new', replayComplete: true });

    await recoverInterruptedHeteroRuns();

    expect(mockReleaseInterruptedRun).toHaveBeenCalledWith('ipc-1');
  });

  it('keeps the ledger entry when recovery dies before reaching an outcome', async () => {
    // Main hands entries over as claims precisely for this: the topic is still
    // mid-run, and the entry is the only thing that can pick it up next launch.
    mockGetTopicDetail.mockRejectedValue(new Error('renderer went away'));

    const results = await recoverInterruptedHeteroRuns();

    expect(results).toEqual([
      { outcome: 'failed', reason: 'renderer went away', topicId: 'topic-1' },
    ]);
    expect(mockReleaseInterruptedRun).not.toHaveBeenCalled();
  });

  it('recovers its own turn when the desktop clock runs behind the database', async () => {
    // `startedAt` is stamped by Electron main, message rows by the server. A
    // desktop a few minutes behind would read this topic's OWN user turn as a
    // newer takeover; the recorded assistant row settles it without a clock.
    mockListInterruptedRuns.mockResolvedValue([
      { ...run, assistantMessageId: 'a1', startedAt: new Date(150).toISOString() },
    ]);
    mockRunHetero.mockResolvedValue({ assistantMessageId: 'a-new', replayComplete: true });

    const results = await recoverInterruptedHeteroRuns();

    expect(results).toEqual([{ outcome: 'replayed', topicId: 'topic-1' }]);
    expect(mockRemoveMessages).toHaveBeenCalledWith(['a1', 't1'], {
      agentId: 'agent-1',
      topicId: 'topic-1',
    });
  });
});
