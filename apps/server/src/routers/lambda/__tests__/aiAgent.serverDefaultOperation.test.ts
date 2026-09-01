// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { agentOperations } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as InternalJwtModule from '@/libs/trpc/utils/internalJwt';

import { aiAgentRouter } from '../aiAgent';
import { cleanupTestUser, createTestTopic, createTestUser } from './integration/setup';

let testDB: LobeChatDatabase;

const { getSupportedModels, initRuntime, resolveModel, signOperationToken } = vi.hoisted(() => ({
  getSupportedModels: vi.fn(),
  initRuntime: vi.fn(),
  resolveModel: vi.fn(),
  signOperationToken: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  getServerDefaultHeterogeneousModels: getSupportedModels,
  initModelRuntimeFromServerConfig: initRuntime,
  resolveServerDefaultHeterogeneousModel: resolveModel,
  SERVER_DEFAULT_HETEROGENEOUS_AGENT_TYPES: [
    'claude-code',
    'codex',
    'grok-build',
    'kimi-code',
    'pi',
    'trae',
  ],
}));

vi.mock('@/libs/trpc/utils/internalJwt', async (importOriginal) => ({
  ...(await importOriginal<typeof InternalJwtModule>()),
  signHeteroOperationJWT: signOperationToken,
}));

describe('server-default heterogeneous operation control', () => {
  let topicId: string;
  let userId: string;

  const caller = (purpose?: string) =>
    aiAgentRouter.createCaller({
      jwtPayload: { userId },
      oidcAuth: { purpose, sub: userId },
      userId,
    } as any);
  const operationInput = (operationId: string) => ({
    agentType: 'codex' as const,
    model: 'gpt-5.4',
    operationId,
    topicId,
  });

  beforeEach(async () => {
    testDB = await getTestDB();
    userId = await createTestUser(testDB);
    topicId = await createTestTopic(testDB, userId);
    vi.stubEnv('ENABLE_SERVER_DEFAULT_HETEROGENEOUS_AGENT', '1');
    getSupportedModels.mockResolvedValue({
      'claude-code': [{ model: 'claude-sonnet-4-6' }],
      'codex': [{ model: 'gpt-5.4' }],
      'grok-build': [{ model: 'kimi-k2.6' }],
      'kimi-code': [{ model: 'kimi-k2.6' }],
      'pi': [{ model: 'kimi-k2.6' }],
      'trae': [{ model: 'kimi-k2.6' }],
    });
    resolveModel.mockResolvedValue({ model: 'gpt-5.4', provider: 'lobehub' });
    initRuntime.mockResolvedValue({});
    signOperationToken.mockResolvedValue('operation-token');
  });

  afterEach(async () => {
    await cleanupTestUser(testDB, userId);
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('persists the scoped operation before minting a model-invocation token', async () => {
    await expect(
      caller().beginServerDefaultHeterogeneousOperation(operationInput('desktop-operation-1')),
    ).resolves.toMatchObject({ model: 'lobehub-default', token: 'operation-token' });

    const [operation] = await testDB
      .select()
      .from(agentOperations)
      .where(eq(agentOperations.id, 'desktop-operation-1'));
    expect(operation).toMatchObject({
      metadata: { agentType: 'codex', serverDefaultHeterogeneous: true },
      model: 'gpt-5.4',
      provider: 'lobehub',
      status: 'running',
      topicId,
      userId,
      workspaceId: null,
    });
    expect(signOperationToken).toHaveBeenCalledWith({
      capabilities: ['model:invoke'],
      model: 'gpt-5.4',
      operationId: 'desktop-operation-1',
      providerId: 'lobehub',
      userId,
      workspaceId: undefined,
    });
    expect(resolveModel).toHaveBeenCalledWith('codex', 'gpt-5.4');
    expect(initRuntime).toHaveBeenCalledWith({
      actorUserId: userId,
      workspaceId: undefined,
    });
  });

  it('accepts and persists a newly supported Kimi Code operation', async () => {
    resolveModel.mockResolvedValueOnce({ model: 'kimi-k2.6', provider: 'lobehub' });

    await expect(
      caller().beginServerDefaultHeterogeneousOperation({
        agentType: 'kimi-code',
        model: 'kimi-k2.6',
        operationId: 'desktop-operation-kimi',
        topicId,
      }),
    ).resolves.toMatchObject({ model: 'lobehub-default', token: 'operation-token' });

    const [operation] = await testDB
      .select()
      .from(agentOperations)
      .where(eq(agentOperations.id, 'desktop-operation-kimi'));
    expect(operation).toMatchObject({
      metadata: { agentType: 'kimi-code', serverDefaultHeterogeneous: true },
      model: 'kimi-k2.6',
      provider: 'lobehub',
      status: 'running',
    });
    expect(resolveModel).toHaveBeenCalledWith('kimi-code', 'kimi-k2.6');
  });

  it('requires a normal user OIDC token for the control plane', async () => {
    await expect(
      caller('hetero-operation').beginServerDefaultHeterogeneousOperation(
        operationInput('desktop-operation-2'),
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(signOperationToken).not.toHaveBeenCalled();
  });

  it('does not persist or mint when the deployment capability is disabled', async () => {
    vi.stubEnv('ENABLE_SERVER_DEFAULT_HETEROGENEOUS_AGENT', '0');

    await expect(
      caller().beginServerDefaultHeterogeneousOperation(operationInput('desktop-operation-3')),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const operations = await testDB
      .select()
      .from(agentOperations)
      .where(eq(agentOperations.id, 'desktop-operation-3'));
    expect(operations).toHaveLength(0);
    expect(signOperationToken).not.toHaveBeenCalled();
  });

  it('does not persist or mint when the selected provider runtime is unavailable', async () => {
    initRuntime.mockRejectedValueOnce(new Error('missing selected provider credentials'));

    await expect(
      caller().beginServerDefaultHeterogeneousOperation(
        operationInput('desktop-operation-runtime'),
      ),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    const operations = await testDB
      .select()
      .from(agentOperations)
      .where(eq(agentOperations.id, 'desktop-operation-runtime'));
    expect(operations).toHaveLength(0);
    expect(signOperationToken).not.toHaveBeenCalled();
  });

  it('does not persist or mint for an agent/runtime pair outside the support matrix', async () => {
    resolveModel.mockRejectedValueOnce(new Error('unsupported agent/runtime pair'));

    await expect(
      caller().beginServerDefaultHeterogeneousOperation({
        ...operationInput('desktop-operation-unsupported'),
        agentType: 'claude-code',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const operations = await testDB
      .select()
      .from(agentOperations)
      .where(eq(agentOperations.id, 'desktop-operation-unsupported'));
    expect(operations).toHaveLength(0);
    expect(signOperationToken).not.toHaveBeenCalled();
  });

  it('settles idempotently and does not remint a token for a reused operation id', async () => {
    const operationId = 'desktop-operation-4';
    await caller().beginServerDefaultHeterogeneousOperation(operationInput(operationId));

    await expect(
      caller().finishServerDefaultHeterogeneousOperation({ operationId, result: 'done' }),
    ).resolves.toEqual({ success: true });
    await expect(
      caller().finishServerDefaultHeterogeneousOperation({ operationId, result: 'done' }),
    ).resolves.toEqual({ success: true });
    await expect(
      caller().beginServerDefaultHeterogeneousOperation(operationInput(operationId)),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const [operation] = await testDB
      .select({ status: agentOperations.status })
      .from(agentOperations)
      .where(eq(agentOperations.id, operationId));
    expect(operation.status).toBe('done');
    expect(signOperationToken).toHaveBeenCalledTimes(1);
  });

  it('does not settle an unrelated operation owned by the same user', async () => {
    const operationId = 'unrelated-operation';
    await testDB.insert(agentOperations).values({
      id: operationId,
      model: 'gpt-5.4',
      provider: 'openai',
      status: 'running',
      topicId,
      userId,
    });

    await expect(
      caller().finishServerDefaultHeterogeneousOperation({ operationId, result: 'done' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const [operation] = await testDB
      .select({ status: agentOperations.status })
      .from(agentOperations)
      .where(eq(agentOperations.id, operationId));
    expect(operation.status).toBe('running');
  });
});
