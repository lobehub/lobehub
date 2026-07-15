import { describe, expect, it, vi } from 'vitest';

const mockHeterogeneousAgent = vi.hoisted(() => ({
  cancelSession: vi.fn(),
  consumeCodexRateLimitResetCredit: vi.fn(),
  getClaudeCodeQuota: vi.fn(),
  getCodexQuota: vi.fn(),
  getSessionInfo: vi.fn(),
  sendPrompt: vi.fn(),
  startSession: vi.fn(),
  stopSession: vi.fn(),
  submitIntervention: vi.fn(),
}));

vi.mock('@/utils/electron/ipc', () => ({
  ensureElectronIpc: () => ({
    heterogeneousAgent: mockHeterogeneousAgent,
  }),
}));

describe('heterogeneousAgentService', () => {
  it('forwards getClaudeCodeQuota params over IPC and returns the snapshot', async () => {
    const { heterogeneousAgentService } = await import('./heterogeneousAgent');

    const snapshot = {
      error: null,
      provider: 'claude-code',
      scopedWeekly: null,
      session: { resetsAt: null, usedPercent: 8, windowMinutes: 300 },
      status: 'ok',
      updatedAt: 1,
      weekly: null,
    };
    mockHeterogeneousAgent.getClaudeCodeQuota.mockResolvedValue(snapshot);

    const params = { env: { CLAUDE_CONFIG_DIR: '/custom/claude' }, force: true };
    await expect(heterogeneousAgentService.getClaudeCodeQuota(params)).resolves.toEqual(snapshot);
    expect(mockHeterogeneousAgent.getClaudeCodeQuota).toHaveBeenCalledWith(params);
  });

  it('forwards getCodexQuota params over IPC and returns the snapshot', async () => {
    const { heterogeneousAgentService } = await import('./heterogeneousAgent');

    const snapshot = {
      error: null,
      provider: 'codex',
      session: null,
      status: 'ok',
      updatedAt: 1,
      weekly: null,
    };
    mockHeterogeneousAgent.getCodexQuota.mockResolvedValue(snapshot);

    const params = {
      command: '/usr/local/bin/codex',
      env: { CODEX_HOME: '/tmp/codex' },
      force: true,
    };
    await expect(heterogeneousAgentService.getCodexQuota(params)).resolves.toEqual(snapshot);
    expect(mockHeterogeneousAgent.getCodexQuota).toHaveBeenCalledWith(params);
  });

  it('forwards Codex reset-credit consumption over IPC', async () => {
    const { heterogeneousAgentService } = await import('./heterogeneousAgent');
    const result = {
      outcome: 'reset',
      quota: {
        error: null,
        provider: 'codex',
        rateLimitResetCredits: { availableCount: 0 },
        session: { resetsAt: null, usedPercent: 0, windowMinutes: 300 },
        status: 'ok',
        updatedAt: 2,
        weekly: null,
      },
    };
    mockHeterogeneousAgent.consumeCodexRateLimitResetCredit.mockResolvedValue(result);
    const params = {
      command: '/usr/local/bin/codex',
      creditId: 'credit-first',
      env: { CODEX_HOME: '/tmp/codex' },
      idempotencyKey: 'redeem-request-1',
    };

    await expect(
      heterogeneousAgentService.consumeCodexRateLimitResetCredit(params),
    ).resolves.toEqual(result);
    expect(mockHeterogeneousAgent.consumeCodexRateLimitResetCredit).toHaveBeenCalledWith(params);
  });

  it('forwards session lifecycle calls over IPC', async () => {
    const { heterogeneousAgentService } = await import('./heterogeneousAgent');

    mockHeterogeneousAgent.startSession.mockResolvedValue({ sessionId: 's1' });
    await expect(
      heterogeneousAgentService.startSession({ agentType: 'claude-code', command: 'claude' }),
    ).resolves.toEqual({ sessionId: 's1' });

    await heterogeneousAgentService.sendPrompt({
      operationId: 'op1',
      prompt: 'hi',
      sessionId: 's1',
      topicId: 'topic-1',
    });
    expect(mockHeterogeneousAgent.sendPrompt).toHaveBeenCalledWith({
      operationId: 'op1',
      prompt: 'hi',
      sessionId: 's1',
      topicId: 'topic-1',
    });

    await heterogeneousAgentService.cancelSession('s1');
    expect(mockHeterogeneousAgent.cancelSession).toHaveBeenCalledWith({ sessionId: 's1' });

    await heterogeneousAgentService.stopSession('s1');
    expect(mockHeterogeneousAgent.stopSession).toHaveBeenCalledWith({ sessionId: 's1' });

    await heterogeneousAgentService.getSessionInfo('s1');
    expect(mockHeterogeneousAgent.getSessionInfo).toHaveBeenCalledWith({ sessionId: 's1' });

    await heterogeneousAgentService.submitIntervention({
      operationId: 'op1',
      result: { answer: 'yes' },
      toolCallId: 't1',
    });
    expect(mockHeterogeneousAgent.submitIntervention).toHaveBeenCalledWith({
      operationId: 'op1',
      result: { answer: 'yes' },
      toolCallId: 't1',
    });
  });
});
