import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { VerifyToolIdentifier } from '@lobechat/builtin-tool-verify';
import type { VerifyCheckItem } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createVerifierAgentRunner } from '../agentVerifier';

// AgentModel/ThreadModel expose their methods as arrow-function class fields
// (instance props, not on the prototype), so they can't be spied via the
// prototype — mock the modules instead. Hoisted so the factories can close over them.
const {
  existsByIdMock,
  getBuiltinAgentMock,
  threadCreateMock,
  execAgentMock,
  settleVerifierCheckFromTerminalMock,
} = vi.hoisted(() => ({
  execAgentMock: vi.fn(async (_params: any) => ({ operationId: 'verifier-op-1' })),
  existsByIdMock: vi.fn(),
  getBuiltinAgentMock: vi.fn(),
  settleVerifierCheckFromTerminalMock: vi.fn(),
  threadCreateMock: vi.fn(async () => ({ id: 'thread-1' })),
}));

/** The single execAgent param object, asserted to exist. */
const execParams = (): any => {
  const call = execAgentMock.mock.calls[0];
  expect(call).toBeDefined();
  return call![0];
};

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({
    existsById: existsByIdMock,
    getBuiltinAgent: getBuiltinAgentMock,
  })),
}));
vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(() => ({ create: threadCreateMock })),
}));
// The runner dynamically imports AiAgentService to break a static cycle.
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({ execAgent: execAgentMock })),
}));
vi.mock('../verifierTerminal', () => ({
  settleVerifierCheckFromTerminal: settleVerifierCheckFromTerminalMock,
}));

const checkItem: VerifyCheckItem = {
  id: 'check-1',
  index: 0,
  onFail: 'manual',
  required: true,
  title: 'Toolbar renders',
  verifierConfig: {},
  verifierType: 'agent',
};

const runnerArgs = { checkItem, goal: 'ship the toolbar', operationId: 'parent-op-1' };
const db = {} as any;

const baseParams = {
  db,
  deliverable: 'the toolbar',
  model: 'gpt-parent',
  provider: 'openai',
  topicId: 'topic-1',
  userId: 'u',
};

describe('createVerifierAgentRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    threadCreateMock.mockResolvedValue({ id: 'thread-1' });
    execAgentMock.mockResolvedValue({ operationId: 'verifier-op-1' });
  });

  it('returns undefined without a topicId (no thread to host the verifier)', () => {
    const runner = createVerifierAgentRunner({ db, deliverable: 'x', topicId: null, userId: 'u' });
    expect(runner).toBeUndefined();
  });

  it('runs a pinned agent by agentId, keeping its own model/provider', async () => {
    existsByIdMock.mockResolvedValue(true);

    const runner = createVerifierAgentRunner({ ...baseParams, verifierAgentId: 'agent-codex' })!;
    const result = await runner(runnerArgs);

    expect(result).toEqual({ verifierOperationId: 'verifier-op-1' });
    expect(existsByIdMock).toHaveBeenCalledWith('agent-codex');
    expect(getBuiltinAgentMock).not.toHaveBeenCalled();

    const params = execParams();
    expect(params.agentId).toBe('agent-codex');
    // A pinned agent keeps its own agency — never overridden by the parent run.
    expect(params.slug).toBeUndefined();
    expect(params.model).toBeUndefined();
    expect(params.provider).toBeUndefined();
    // A pinned agent lacks the writeback tool, so it must be injected.
    expect(params.additionalPluginIds).toEqual([VerifyToolIdentifier]);
  });

  it('falls back to the builtin verify agent (by slug) with the provided verify model config', async () => {
    existsByIdMock.mockResolvedValue(false); // pinned id no longer exists
    getBuiltinAgentMock.mockResolvedValue({ id: 'builtin-verify' });

    const runner = createVerifierAgentRunner({ ...baseParams, verifierAgentId: 'agent-deleted' })!;
    await runner(runnerArgs);

    expect(getBuiltinAgentMock).toHaveBeenCalledWith(BUILTIN_AGENT_SLUGS.verifyAgent);
    const params = execParams();
    expect(params.slug).toBe(BUILTIN_AGENT_SLUGS.verifyAgent);
    expect(params.agentId).toBeUndefined();
    expect(params.model).toBe('gpt-parent');
    expect(params.provider).toBe('openai');
    // The builtin verify agent already declares the tool — not re-injected.
    expect(params.additionalPluginIds).toBeUndefined();
  });

  it('registers a verifier-terminal hook for local and queued completion handling', async () => {
    getBuiltinAgentMock.mockResolvedValue({ id: 'builtin-verify' });

    const runner = createVerifierAgentRunner({ ...baseParams, workspaceId: 'ws-1' })!;
    await runner(runnerArgs);

    const hooks = execParams().hooks;
    expect(hooks).toEqual([
      expect.objectContaining({
        id: 'verify-agent-terminal',
        type: 'onComplete',
        webhook: expect.objectContaining({
          body: {
            checkItemId: 'check-1',
            parentOperationId: 'parent-op-1',
            userId: 'u',
            workspaceId: 'ws-1',
          },
          delivery: 'qstash',
          url: '/api/workflows/verify/on-verifier-complete',
        }),
      }),
    ]);

    await hooks[0].handler({
      agentId: 'agent',
      errorMessage: 'bad key',
      operationId: 'verifier-op-1',
      reason: 'error',
      userId: 'u',
    });

    expect(settleVerifierCheckFromTerminalMock).toHaveBeenCalledWith(
      db,
      'u',
      {
        checkItemId: 'check-1',
        errorMessage: 'bad key',
        parentOperationId: 'parent-op-1',
        reason: 'error',
        verifierOperationId: 'verifier-op-1',
      },
      'ws-1',
    );
  });

  it('uses the builtin agent when no verifierAgentId is pinned', async () => {
    getBuiltinAgentMock.mockResolvedValue({ id: 'builtin-verify' });

    const runner = createVerifierAgentRunner({ ...baseParams })!;
    await runner(runnerArgs);

    // No pinned id → never probes existsById, goes straight to the builtin.
    expect(existsByIdMock).not.toHaveBeenCalled();
    expect(execParams().slug).toBe(BUILTIN_AGENT_SLUGS.verifyAgent);
  });

  it('injects the builder-captured evidence into the verifier prompt', async () => {
    getBuiltinAgentMock.mockResolvedValue({ id: 'builtin-verify' });

    const runner = createVerifierAgentRunner({ ...baseParams })!;
    await runner({
      ...runnerArgs,
      evidence: [
        { description: 'toolbar screenshot', type: 'screenshot' },
        { content: 'aria-label="Send"', description: 'DOM', type: 'dom_snapshot' },
      ],
    });

    const prompt: string = execParams().prompt;
    expect(prompt).toContain('## Captured evidence');
    expect(prompt).toContain('toolbar screenshot');
    expect(prompt).toContain('[artifact captured]'); // screenshot referenced by presence
    expect(prompt).toContain('aria-label="Send"'); // inline dom text quoted
  });

  it('omits the captured-evidence section when no evidence was provided', async () => {
    getBuiltinAgentMock.mockResolvedValue({ id: 'builtin-verify' });

    const runner = createVerifierAgentRunner({ ...baseParams })!;
    await runner(runnerArgs);

    expect(execParams().prompt).not.toContain('## Captured evidence');
  });

  it('attaches file-backed evidence to the verifier run so it can see the artifact', async () => {
    getBuiltinAgentMock.mockResolvedValue({ id: 'builtin-verify' });

    const runner = createVerifierAgentRunner({ ...baseParams })!;
    await runner({
      ...runnerArgs,
      evidence: [
        { description: 'toolbar', fileId: 'file-shot-1', type: 'screenshot' },
        { content: 'inline only', type: 'dom_snapshot' }, // no fileId
        { description: 'demo', fileId: 'file-vid-1', type: 'video' },
      ],
    });

    // Only the file-backed artifacts are forwarded to execAgent (inline-text has none).
    expect(execParams().fileIds).toEqual(['file-shot-1', 'file-vid-1']);
  });

  it('does not pass fileIds when no evidence is file-backed', async () => {
    getBuiltinAgentMock.mockResolvedValue({ id: 'builtin-verify' });

    const runner = createVerifierAgentRunner({ ...baseParams })!;
    await runner({ ...runnerArgs, evidence: [{ content: 'text', type: 'text' }] });

    expect(execParams().fileIds).toBeUndefined();
  });
});
