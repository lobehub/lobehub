import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCodexAgentHandle } from './codexAgentHandle';
import type { CodexThreadSessionOptions } from './CodexThreadSession';

const fixture = vi.hoisted(() => ({
  close: vi.fn(),
  interrupt: vi.fn(async () => {}),
  options: undefined as CodexThreadSessionOptions | undefined,
  resolveApproval: vi.fn(() => true),
  run: vi.fn(),
  shutdown: vi.fn(async () => {}),
}));

vi.mock('@lobechat/utils/managedProcess', () => ({
  ManagedProcessRegistry: class {
    register() {}
    shutdown = fixture.shutdown;
  },
}));
vi.mock('./CodexAppServerClient', () => ({
  CodexAppServerClient: class {
    close = vi.fn();
    onStderr = () => () => {};
  },
}));
vi.mock('./CodexThreadSession', () => ({
  CodexThreadSession: class {
    constructor(options: CodexThreadSessionOptions) {
      fixture.options = options;
    }
    close = fixture.close;
    interrupt = fixture.interrupt;
    resolveApproval = fixture.resolveApproval;
    run = fixture.run;
  },
}));
vi.mock('../spawn/codexModel', () => ({
  readCodexSessionModel: vi.fn(async () => undefined),
  resolveCodexInitialModel: vi.fn(async () => ({ model: 'gpt-5.4' })),
}));

/** @example A dispatched Codex turn keeps its preset and exact callback across the CLI boundary. */
describe('Codex device runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixture.options = undefined;
    fixture.resolveApproval.mockReturnValue(true);
    fixture.close.mockReset();
    fixture.run.mockResolvedValue(undefined);
    fixture.shutdown.mockResolvedValue(undefined);
  });

  /** @example Resume receives read-only/on-request and never enables exec fallback. */
  it('passes the preset into the native session and preserves its resume identity', async () => {
    const handle = await createCodexAgentHandle({
      agentType: 'codex',
      operationId: 'op-1',
      prompt: 'read context',
      cwd: '/workspace',
      codexPermissionMode: 'read-only',
      resumeSessionId: 'native-1',
    });
    await handle.exit;
    /** @example The factory does not silently broaden a saved permission profile. */
    expect(fixture.options).toMatchObject({
      allowExecFallback: false,
      initialThreadId: 'native-1',
      threadParams: {
        approvalPolicy: 'on-request',
        sandbox: 'read-only',
        approvalsReviewer: 'user',
      },
    });
    /** @example The caller can retain the real native thread for the next turn. */
    expect(handle.sessionId).toBe('native-1');
  });

  /** @example An opaque durable option is decoded only for its live native request. */
  it('binds decisions to the callback and advertised option set', async () => {
    const run = Promise.withResolvers<void>();
    fixture.run.mockReturnValue(run.promise);
    const handle = await createCodexAgentHandle({
      agentType: 'codex',
      operationId: 'op-1',
      prompt: 'write guarded',
      cwd: '/workspace',
      codexPermissionMode: 'ask',
    });
    await fixture.options!.onEvents([
      {
        type: 'agent_intervention_request',
        operationId: 'op-1',
        stepIndex: 0,
        timestamp: 1,
        data: {
          apiName: 'command_execution',
          arguments: '{"availableDecisions":["accept","decline"]}',
          interventionId: 'callback-1',
          toolCallId: 'item-1',
        },
      },
    ]);
    /** @example A stale callback cannot authorize the current item. */
    expect(
      handle.resolveIntervention({
        toolCallId: 'item-1',
        interventionId: 'old',
        result: { decision: 'accept' },
      }),
    ).toBe(false);
    /** @example An index outside native choices is rejected. */
    expect(
      handle.resolveIntervention({
        toolCallId: 'item-1',
        interventionId: 'callback-1',
        result: { 'write guarded': 'decision_99' },
      }),
    ).toBe(false);
    /** @example The provider receipt itself cannot be replayed as a user's decision. */
    expect(
      handle.resolveIntervention({
        toolCallId: 'item-1',
        interventionId: 'callback-1',
        producerAck: true,
        result: { decision: 'accept' },
      }),
    ).toBe(false);
    handle.resolveIntervention({
      toolCallId: 'item-1',
      interventionId: 'callback-1',
      resolutionRequestId: 'resolution-1',
      result: { 'write guarded': 'decision_1' },
    });
    /** @example The callback translates only to its advertised Deny decision. */
    expect(fixture.resolveApproval).toHaveBeenCalledWith(
      'op-1',
      'callback-1',
      'decline',
      expect.objectContaining({ resolutionRequestId: 'resolution-1' }),
    );
    run.resolve();
    await handle.exit;
    /** @example A completed turn leaves no pending device approval. */
    expect(handle.pendingApprovalCount).toBe(0);
  });

  // ROOT CAUSE:
  // The wrapper used to settle exit as soon as session.run ended, while its
  // detached app-server could ignore TERM and continue writing. The private
  // process registry now owns teardown and handle.exit waits for that teardown.
  /** @example Stop cannot report exit while native descendants are still alive. */
  it('waits for managed native process shutdown before settling a stopped run', async () => {
    const run = Promise.withResolvers<void>();
    const shutdown = Promise.withResolvers<void>();
    fixture.run.mockReturnValue(run.promise);
    fixture.close.mockImplementation(() => run.resolve());
    fixture.shutdown.mockReturnValue(shutdown.promise);
    const handle = await createCodexAgentHandle({
      agentType: 'codex',
      operationId: 'op-stop',
      prompt: 'long shell',
      cwd: '/workspace',
      codexPermissionMode: 'ask',
    });
    let exited = false;
    void handle.exit.then(() => {
      exited = true;
    });
    handle.kill('SIGKILL');
    await Promise.resolve();
    /** @example Stop waits for the registry's real process-tree termination. */
    expect(exited).toBe(false);
    shutdown.resolve();
    /** @example Only completed teardown produces the terminal wrapper signal. */
    await expect(handle.exit).resolves.toEqual({ code: null, signal: 'SIGKILL' });
  });

  // ROOT CAUSE:
  // Daemon dispatch already signals the wrapper's process group and therefore
  // calls handle.interrupt instead of handle.kill. Native Codex owns a separate
  // app-server group; omitting interrupt leaves that group running after Stop.
  // Preserve the shared protocol cancellation contract and await native teardown.
  /** @example Both inherited signals stop the detached native process tree. */
  it.each(['SIGINT', 'SIGTERM'] as const)(
    'stops native Codex after an inherited-group %s',
    async (signal) => {
      const run = Promise.withResolvers<void>();
      const shutdown = Promise.withResolvers<void>();
      fixture.run.mockReturnValue(run.promise);
      fixture.close.mockImplementation(() => run.resolve());
      fixture.shutdown.mockReturnValue(shutdown.promise);
      const handle = await createCodexAgentHandle({
        agentType: 'codex',
        operationId: 'op-inherited-signal',
        prompt: 'long shell',
        cwd: process.cwd(),
        codexPermissionMode: 'ask',
      });
      /** @example The daemon's protocol-only cancellation has a real handler. */
      expect(handle.interrupt).toBeTypeOf('function');
      handle.interrupt?.(signal);
      /** @example Native teardown runs even when the parent group was signalled already. */
      expect(fixture.close).toHaveBeenCalled();
      if (signal === 'SIGINT') {
        /** @example SIGINT also delivers the native turn interrupt. */
        expect(fixture.interrupt).toHaveBeenCalledOnce();
      }
      shutdown.resolve();
      /** @example The original cancellation signal survives completed containment. */
      await expect(handle.exit).resolves.toEqual({ code: null, signal });
    },
  );

  // ROOT CAUSE:
  // Host cancellation used to mask every run error, including failed process
  // containment. Teardown now runs after that cancellation mapping and must
  // succeed before the runtime can report exit.
  /** @example Stop reports failure if the native process tree could not be terminated. */
  it('exposes teardown failure even after a requested Stop', async () => {
    const run = Promise.withResolvers<void>();
    const failure = new Error('Managed processes remain after SIGKILL');
    fixture.run.mockReturnValue(run.promise);
    fixture.close.mockImplementation(() => run.resolve());
    fixture.shutdown.mockRejectedValue(failure);
    const handle = await createCodexAgentHandle({
      agentType: 'codex',
      operationId: 'op-stop-failed',
      prompt: 'long shell',
      cwd: '/workspace',
      codexPermissionMode: 'ask',
    });
    handle.kill('SIGKILL');
    /** @example The wrapper must not receive a successful cancelled exit. */
    await expect(handle.exit).rejects.toBe(failure);
    /** @example Event consumers receive the same containment failure. */
    await expect(handle.events[Symbol.asyncIterator]().next()).rejects.toBe(failure);
  });

  // ROOT CAUSE:
  // Native sessions emit an interrupted terminal event but resolve run(). Mapping
  // every resolved run to code 0 incorrectly reported interrupted work as success.
  /** @example Native cancellation without an OS signal still has a nonzero exit. */
  it('does not report an interrupted native turn as successful', async () => {
    fixture.run.mockImplementation(async () => {
      await fixture.options!.onEvents([
        {
          type: 'agent_runtime_end',
          operationId: 'op-interrupt',
          stepIndex: 0,
          timestamp: 1,
          data: { reason: 'interrupted' },
        },
      ]);
    });
    const handle = await createCodexAgentHandle({
      agentType: 'codex',
      operationId: 'op-interrupt',
      prompt: 'guarded write',
      cwd: '/workspace',
      codexPermissionMode: 'ask',
    });
    /** @example Successful promise completion is not successful native execution. */
    await expect(handle.exit).resolves.toEqual({ code: 1, signal: null });
  });
});
