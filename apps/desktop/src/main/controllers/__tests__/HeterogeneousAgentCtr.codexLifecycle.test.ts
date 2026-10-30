import type * as fsModule from 'node:fs';
import { existsSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type * as spawnModule from '@lobechat/heterogeneous-agents/spawn';
import * as managedProcess from '@lobechat/utils/managedProcess';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import HeterogeneousAgentCtr from '../HeterogeneousAgentImpl';

const controls = vi.hoisted(() => ({
  codexAppServerCanReuse: { value: true },
  codexAppServerClientCloseMock: vi.fn(),
  codexAppServerClientConstructMock: vi.fn(),
  codexAppServerCloseMock: vi.fn(),
  codexAppServerConsumerCount: { value: 0 },
  codexAppServerConstructMock: vi.fn(),
  codexAppServerInterruptMock: vi.fn(),
  codexAppServerRunMock: vi.fn(),
  codexAppServerShouldFailAfterThread: { value: false },
  codexAppServerShouldFailResume: { value: false },
  codexAppServerShouldFallback: { value: false },
}));
const {
  codexAppServerClientConstructMock,
  codexAppServerConstructMock,
  codexAppServerRunMock,
  codexAppServerCloseMock,
} = controls;

vi.mock('@lobechat/heterogeneous-agents/spawn', async (importOriginal) => {
  const { createCodexAppServerMocks } = await import('./testUtils');
  const actual = await importOriginal<typeof spawnModule>();
  return { ...actual, ...createCodexAppServerMocks(actual, controls) };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fsModule>();
  return { ...actual, existsSync: vi.fn(() => true), statSync: vi.fn() };
});

vi.mock('@/modules/binaries', () => ({
  detectHeterogeneousCliCommand: vi.fn(async () => ({
    available: true,
    path: '/usr/local/bin/codex',
    resolvedPathEnv: '/usr/local/bin:/usr/bin',
  })),
}));

/** @example Concurrent topics retain their provenance and reload can release a native thread. */
describe('HeterogeneousAgentCtr Codex lifecycle', () => {
  let appStoragePath: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    controls.codexAppServerConsumerCount.value = 0;
    controls.codexAppServerRunMock.mockReset();
    vi.stubEnv('LOBE_CODEX_APP_SERVER', '');
    // A desktop launched from an agent shell inherits that run's identity;
    // the assertions below are about what the app adds, not the host shell.
    for (const key of ['LOBEHUB_PROCESS_TOPIC', 'AGENT_BROWSER_NAMESPACE'])
      vi.stubEnv(key, undefined);
    vi.mocked(existsSync).mockReturnValue(true);
    // The fake desktop path is a directory for spawn preflight; ledger IO stays real.
    vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as ReturnType<typeof statSync>);
    appStoragePath = await mkdtemp(path.join(os.tmpdir(), 'lobehub-codex-lifecycle-'));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(appStoragePath, { force: true, recursive: true });
  });

  /** @example Two overlapping turns use one compatible client and independent provenance. */
  it('reuses one native app-server client for sessions owned by different topics and agents', async () => {
    let releaseFirstRun!: () => void;
    const firstRun = new Promise<void>((resolve) => {
      releaseFirstRun = resolve;
    });
    const registry = new managedProcess.ManagedProcessRegistry();
    const environment = vi
      .spyOn(managedProcess, 'managedProcessEnvironment')
      .mockImplementation(registry.environment.bind(registry));
    try {
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as unknown as App);
      const first = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
        env: {
          LOBEHUB_AGENT_ID: 'agent-1',
          LOBEHUB_TOPIC_ID: 'topic-1',
          LOBEHUB_OPERATION_ID: 'op-1',
        },
        useCodexAppServer: true,
      });
      const second = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
        env: {
          LOBEHUB_AGENT_ID: 'agent-2',
          LOBEHUB_TOPIC_ID: 'topic-2',
          LOBEHUB_OPERATION_ID: 'op-2',
        },
        useCodexAppServer: true,
      });

      codexAppServerRunMock.mockImplementationOnce(() => firstRun);
      const firstPrompt = ctr.sendPrompt({
        agentId: 'agent-1',
        topicId: 'topic-1',
        operationId: 'op-1',
        prompt: 'first',
        sessionId: first.sessionId,
      });
      await vi.waitFor(() => expect(codexAppServerRunMock).toHaveBeenCalledTimes(1));
      const secondPrompt = ctr.sendPrompt({
        agentId: 'agent-2',
        topicId: 'topic-2',
        operationId: 'op-2',
        prompt: 'second',
        sessionId: second.sessionId,
      });

      // The second turn starts while the first still holds its consumer.
      await vi.waitFor(() => expect(codexAppServerRunMock).toHaveBeenCalledTimes(2));
      releaseFirstRun();
      await Promise.all([firstPrompt, secondPrompt]);
      expect(codexAppServerRunMock.mock.calls.map(([options]) => options.provenance)).toEqual([
        {
          LOBEHUB_AGENT_ID: 'agent-1',
          LOBEHUB_OPERATION_ID: 'op-1',
          LOBEHUB_TOPIC_ID: 'topic-1',
        },
        {
          LOBEHUB_AGENT_ID: 'agent-2',
          LOBEHUB_OPERATION_ID: 'op-2',
          LOBEHUB_TOPIC_ID: 'topic-2',
        },
      ]);
      expect(codexAppServerClientConstructMock).toHaveBeenCalledTimes(1);
      expect(codexAppServerConstructMock).toHaveBeenCalledTimes(2);
      const { env } = codexAppServerClientConstructMock.mock.calls[0][0];
      expect(env.LOBEHUB_PROCESS_TOPIC).toBeUndefined();
      expect(env.AGENT_BROWSER_NAMESPACE).toBeUndefined();
    } finally {
      releaseFirstRun();
      environment.mockRestore();
    }
  });

  /** @example Renderer recovery finds and closes an orphaned app-server run. */
  it('records app-server runs so reload recovery stops the orphaned session', async () => {
    let releaseRun!: () => void;
    codexAppServerRunMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseRun = resolve;
        }),
    );
    const ctr = new HeterogeneousAgentCtr({
      appStoragePath,
      storeManager: { get: vi.fn() },
    } as unknown as App);
    const { sessionId } = await ctr.startSession({
      agentType: 'codex',
      command: 'codex',
      resumeSessionId: 'thread-existing',
      useCodexAppServer: true,
    });
    const prompt = ctr.sendPrompt({
      agentId: 'agent-1',
      operationId: 'op-1',
      prompt: 'still running',
      sessionId,
      topicId: 'topic-1',
    });
    await vi.waitFor(() => expect(codexAppServerRunMock).toHaveBeenCalledTimes(1));

    // A reloaded renderer runs restart recovery before the next send in the same topic.
    // Without the ledger entry the old session keeps the native thread claimed.
    await expect(ctr.listInterruptedRuns({})).resolves.toEqual([
      expect.objectContaining({
        agentSessionId: 'thread-existing',
        agentType: 'codex',
        ipcSessionId: sessionId,
        topicId: 'topic-1',
      }),
    ]);
    expect(codexAppServerCloseMock).toHaveBeenCalled();

    releaseRun();
    await prompt;
  });
});
