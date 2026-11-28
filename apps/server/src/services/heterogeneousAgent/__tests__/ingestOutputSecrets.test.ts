// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CompletionLifecycle } from '@/server/services/agentRuntime/CompletionLifecycle';

import { HeterogeneousAgentService } from '..';
import { __resetOperationStatesForTesting } from '../HeterogeneousPersistenceHandler';
import { buildEvent, createHarness } from '../HeterogeneousPersistenceHandler/testUtils';
import { fingerprintSecret } from '../outputSecrets';

const mocks = vi.hoisted(() => ({
  afterWork: [] as (() => Promise<unknown> | unknown)[],
  onAgentOutputSecretsDetected: vi.fn(),
}));

vi.mock('@/business/server/agentOutputSecrets', () => ({
  onAgentOutputSecretsDetected: mocks.onAgentOutputSecretsDetected,
}));

vi.mock('@/server/utils/scheduleAfterResponse', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  afterUnscoped: (work: () => Promise<unknown> | unknown) => {
    mocks.afterWork.push(work);
  },
}));

const TOKEN = `sk-ant-oat01-${'x'.repeat(48)}`;

/** A run asked to print its environment must not put its login into the topic. */
describe('HeterogeneousAgentService.heteroIngest — credentials in output', () => {
  beforeEach(() => {
    __resetOperationStatesForTesting();
    mocks.afterWork.length = 0;
    mocks.onAgentOutputSecretsDetected.mockReset();
  });
  afterEach(() => __resetOperationStatesForTesting());

  it('redacts the token before it is stored or streamed and reports it', async () => {
    const h = createHarness({
      assistantMessageId: 'asst-1',
      operationId: 'op-1',
      topicId: 'tpc-1',
    });
    const publishStreamEvent = vi.fn(async (_operationId: string, _event: any) => 'ok');
    const service = new HeterogeneousAgentService({} as any, 'user-1', {
      agentOperationModel: { touchRunning: vi.fn(async () => true) } as any,
      persistenceHandler: h.handler,
      snapshotStore: null,
      streamEventManager: { publishStreamEvent } as any,
      topicModel: h.topicModel as any,
      workspaceId: 'ws-1',
    });
    const tool = {
      apiName: 'Bash',
      arguments: '{"command":"env"}',
      id: 'tc-1',
      identifier: 'bash',
    };

    await service.heteroIngest({
      agentType: 'claude-code',
      events: [
        buildEvent('stream_start', 0, {}),
        buildEvent('stream_chunk', 1, { chunkType: 'tools_calling', toolsCalling: [tool] }),
        buildEvent('tool_result', 2, {
          content: `CLAUDE_CODE_OAUTH_TOKEN=${TOKEN}`,
          toolCallId: 'tc-1',
        }),
      ],
      operationId: 'op-1',
      topicId: 'tpc-1',
    });

    expect(JSON.stringify([...h.messages.values()])).not.toContain(TOKEN);
    expect(JSON.stringify(publishStreamEvent.mock.calls)).not.toContain(TOKEN);

    for (const work of mocks.afterWork.splice(0)) await work();
    expect(mocks.onAgentOutputSecretsDetected).toHaveBeenCalledWith({
      agentType: 'claude-code',
      operationId: 'op-1',
      secrets: [{ fingerprint: fingerprintSecret(TOKEN), kind: 'anthropic-oauth-token' }],
      topicId: 'tpc-1',
      userId: 'user-1',
      workspaceId: 'ws-1',
    });
  });

  it('redacts a token in the terminal error the CLI reports on its own', async () => {
    vi.spyOn(CompletionLifecycle.prototype, 'completeOperation').mockResolvedValue(
      undefined as any,
    );
    const finish = vi.fn(async () => undefined);
    const publishStreamEvent = vi.fn(async (_operationId: string, _event: any) => 'ok');
    const service = new HeterogeneousAgentService({} as any, 'user-1', {
      agentOperationModel: { findById: vi.fn(async () => ({ metadata: {} })) } as any,
      persistenceHandler: { finish } as any,
      snapshotStore: null,
      streamEventManager: { publishStreamEvent } as any,
      topicModel: {
        settleRunningOperation: vi.fn(async () => ({ status: 'settled' })),
        updateMetadata: vi.fn(async () => undefined),
      } as any,
    });

    await service.heteroFinish({
      agentType: 'claude-code',
      error: {
        body: { detail: `token=${TOKEN}` },
        message: `auth failed for ${TOKEN}`,
        type: 'AgentRuntimeError',
      },
      operationId: 'op-1',
      result: 'error',
      topicId: 'tpc-1',
    });

    expect(JSON.stringify(publishStreamEvent.mock.calls)).not.toContain(TOKEN);
    expect(JSON.stringify((finish.mock.calls as unknown[]) ?? [])).not.toContain(TOKEN);
    for (const work of mocks.afterWork.splice(0)) await work();
    expect(mocks.onAgentOutputSecretsDetected).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'op-1',
        secrets: [{ fingerprint: fingerprintSecret(TOKEN), kind: 'anthropic-oauth-token' }],
      }),
    );
  });
});
