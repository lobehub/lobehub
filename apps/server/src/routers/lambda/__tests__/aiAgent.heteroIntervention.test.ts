// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentRouter } from '../aiAgent';
import { cleanupTestUser, createTestUser } from './integration/setup';

// Mock getServerDB to return our test database instance
let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

// Shared in-memory stream backing both procedures. The remote HITL loop only
// touches `publishStreamEvent` (browser leg) + `readEventsOnce` (exec leg), so a
// tiny store-backed stub of the factory is enough to exercise the round-trip
// without a live Redis. An unknown `lastEventId` reads from the start (mirrors
// Redis `XREAD 0`); `'$'` means from-now.
const { store } = vi.hoisted(() => ({ store: { events: [] as any[], seq: 0 } }));
vi.mock('@/server/modules/AgentRuntime/factory', () => ({
  createStreamEventManager: () => ({
    async publishStreamEvent(operationId: string, event: any) {
      const id = String(++store.seq);
      store.events.push({ ...event, id, operationId });
      return id;
    },
    async readEventsOnce(operationId: string, lastEventId = '$') {
      const all = store.events.filter((e) => e.operationId === operationId);
      if (lastEventId === '$') return { events: [], lastEventId: all.at(-1)?.id ?? '0' };
      const idx = all.findIndex((e) => e.id === lastEventId);
      const events = idx >= 0 ? all.slice(idx + 1) : all.slice();
      return { events, lastEventId: events.at(-1)?.id ?? lastEventId };
    },
  }),
}));

// Services constructed by the aiAgentProcedure / heteroAgentProcedure middleware
// — stub so the test stays isolated from their real deps.
vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@/server/services/aiChat', () => ({
  AiChatService: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@/server/services/heterogeneousAgent', () => ({
  HeterogeneousAgentService: vi.fn().mockImplementation(() => ({})),
}));

describe('aiAgentRouter — remote Human-in-the-loop', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);
    store.events.length = 0;
    store.seq = 0;
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
    vi.clearAllMocks();
  });

  // Browser leg: user JWT.
  const userCaller = () => aiAgentRouter.createCaller({ jwtPayload: { userId }, userId } as any);
  // Exec leg: operation-bound JWT claims produced by the server signer.
  const heteroCaller = (operationId: string) =>
    aiAgentRouter.createCaller({
      jwtPayload: { userId },
      oidcAuth: {
        aud: 'urn:lobehub:hetero-operation',
        capabilities: ['hetero:intervention:read'],
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        iss: 'urn:lobehub:internal',
        jti: `jti-${operationId}`,
        operation_id: operationId,
        purpose: 'hetero-operation',
        sub: userId,
      },
      userId,
    } as any);
  // Exec leg from a token minted before operation-bound claims were deployed.
  const legacyHeteroCaller = (sub: string) =>
    aiAgentRouter.createCaller({
      jwtPayload: { userId: sub },
      oidcAuth: { purpose: 'hetero-operation', sub },
      userId: sub,
    } as any);
  // Exec leg via an owner OIDC token (a desktop reusing its own session): a
  // normal token whose `purpose` is NOT `hetero-operation` → heteroAuthKind
  // resolves to 'user', so the ownership guard applies.
  const ownerTokenCaller = (sub: string) =>
    aiAgentRouter.createCaller({
      jwtPayload: { userId: sub },
      oidcAuth: { sub },
      userId: sub,
    } as any);

  const insertOperation = async (id: string, ownerId: string) => {
    const { agentOperations } = await import('@/database/schemas');
    await serverDB.insert(agentOperations).values({ id, status: 'running', userId: ownerId });
  };

  it('submit → wait round-trips a structured answer, filtered to the response', async () => {
    const operationId = 'op-roundtrip';
    await insertOperation(operationId, userId);
    await userCaller().submitHeteroIntervention({
      operationId,
      result: { 'Which env?': 'prod' },
      toolCallId: 't1',
    });

    const res = await heteroCaller(operationId).waitInterventionResponse({
      lastEventId: '0',
      operationId,
    });

    expect(res.events).toHaveLength(1);
    expect(res.events[0].type).toBe('agent_intervention_response');
    expect(res.events[0].data).toMatchObject({
      result: { 'Which env?': 'prod' },
      toolCallId: 't1',
    });
    expect(res.events[0].data.cancelled).toBeUndefined();
  });

  it('cancel clears the result and defaults the reason', async () => {
    const operationId = 'op-cancel';
    await insertOperation(operationId, userId);
    await userCaller().submitHeteroIntervention({
      cancelled: true,
      operationId,
      result: { should: 'be dropped' },
      toolCallId: 't2',
    });

    const res = await heteroCaller(operationId).waitInterventionResponse({
      lastEventId: '0',
      operationId,
    });

    expect(res.events[0].data).toMatchObject({
      cancelReason: 'user_cancelled',
      cancelled: true,
      toolCallId: 't2',
    });
    expect(res.events[0].data.result).toBeUndefined();
  });

  it('waitInterventionResponse ignores non-intervention events on the stream', async () => {
    const operationId = 'op-ignore-non-intervention';
    await insertOperation(operationId, userId);
    // A plain stream event lands on the op's stream but is not an answer.
    store.events.push({
      data: {},
      id: String(++store.seq),
      operationId,
      stepIndex: 0,
      type: 'stream_chunk',
    });

    const res = await heteroCaller(operationId).waitInterventionResponse({
      lastEventId: '0',
      operationId,
    });

    expect(res.events).toHaveLength(0);
  });

  describe('waitInterventionResponse ownership guard', () => {
    it('lets a pre-deploy operation token read an operation owned by its subject', async () => {
      await insertOperation('op-legacy-owned', userId);
      await userCaller().submitHeteroIntervention({
        operationId: 'op-legacy-owned',
        result: { answer: 'yes' },
        toolCallId: 't-legacy-own',
      });

      const res = await legacyHeteroCaller(userId).waitInterventionResponse({
        lastEventId: '0',
        operationId: 'op-legacy-owned',
      });

      expect(res.events).toHaveLength(1);
      expect(res.events[0].data).toMatchObject({ toolCallId: 't-legacy-own' });
    });

    it("rejects a pre-deploy operation token reading another user's operation", async () => {
      const otherUserId = await createTestUser(serverDB);
      await insertOperation('op-legacy-others', otherUserId);

      await expect(
        legacyHeteroCaller(userId).waitInterventionResponse({
          lastEventId: '0',
          operationId: 'op-legacy-others',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      await cleanupTestUser(serverDB, otherUserId);
    });

    it('lets an owner token read its own operation', async () => {
      await insertOperation('op-owned', userId);
      await userCaller().submitHeteroIntervention({
        operationId: 'op-owned',
        result: { answer: 'yes' },
        toolCallId: 't-own',
      });

      const res = await ownerTokenCaller(userId).waitInterventionResponse({
        lastEventId: '0',
        operationId: 'op-owned',
      });

      expect(res.events).toHaveLength(1);
      expect(res.events[0].data).toMatchObject({ toolCallId: 't-own' });
    });

    it("rejects an owner token reading another user's operation", async () => {
      const otherUserId = await createTestUser(serverDB);
      await insertOperation('op-others', otherUserId);
      // The victim's answer lands on the stream…
      await userCaller().submitHeteroIntervention({
        operationId: 'op-others',
        result: { secret: 'leak me' },
        toolCallId: 't-victim',
      });

      // …but a different signed-in user must not be able to long-poll it.
      await expect(
        ownerTokenCaller(userId).waitInterventionResponse({
          lastEventId: '0',
          operationId: 'op-others',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      await cleanupTestUser(serverDB, otherUserId);
    });

    it('rejects an owner token for an unknown operation id', async () => {
      await expect(
        ownerTokenCaller(userId).waitInterventionResponse({
          lastEventId: '0',
          operationId: 'op-missing',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('rejects a server-minted token when its durable operation row is missing', async () => {
      await expect(
        heteroCaller('op-no-row').waitInterventionResponse({
          lastEventId: '0',
          operationId: 'op-no-row',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });
});
