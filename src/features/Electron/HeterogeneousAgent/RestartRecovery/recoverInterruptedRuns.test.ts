import { HETERO_RESTART_CONTINUE_PROMPT } from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { recoverInterruptedHeteroRuns } from './recoverInterruptedRuns';

const mockListInterruptedRuns = vi.fn();
const mockProbeTranscriptReplay = vi.fn();
vi.mock('@/services/electron/heterogeneousAgent', () => ({
  heterogeneousAgentService: {
    listInterruptedRuns: (...args: unknown[]) => mockListInterruptedRuns(...args),
    probeTranscriptReplay: (...args: unknown[]) => mockProbeTranscriptReplay(...args),
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
      { ...run, agentSessionId: 'cc-from-ledger', configDir: '/profile', cwd: '/repo' },
    ]);
    mockGetTopicDetail.mockResolvedValue({ ...topic, metadata: { workingDirectory: '/repo' } });
    mockRunHetero.mockResolvedValue({ assistantMessageId: 'a-new', replayComplete: true });

    const results = await recoverInterruptedHeteroRuns();

    expect(results).toEqual([{ outcome: 'replayed', topicId: 'topic-1' }]);
    expect(chatStore.updateTopicMetadata).toHaveBeenCalledWith('topic-1', {
      heteroSessionId: 'cc-from-ledger',
      heteroSessionIdByWorkingDirectory: { '/repo': 'cc-from-ledger' },
      workingDirectory: '/repo',
    });
    expect(mockProbeTranscriptReplay).toHaveBeenCalledWith({
      agentType: 'claude-code',
      configDir: '/profile',
      cwd: '/repo',
      sessionId: 'cc-from-ledger',
    });
    // The run itself sees the patched topic so resume resolves from it.
    expect(mockRunHetero.mock.calls[0][1].topic.metadata).toMatchObject({
      heteroSessionIdByWorkingDirectory: { '/repo': 'cc-from-ledger' },
    });
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
  });
});
