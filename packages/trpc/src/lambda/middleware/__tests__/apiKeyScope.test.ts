import { describe, expect, it } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { trpc } from '@/libs/trpc/lambda/init';

import { apiKeyScopeGuard } from '../apiKeyScope';

// Routers whose namespaces map to real catalog rules — the guard derives the
// required scope from `path`, so the namespaces here must exist in
// TRPC_NAMESPACE_API_KEY_RULES.
const guarded = trpc.procedure.use(apiKeyScopeGuard);

const testRouter = trpc.router({
  agent: trpc.router({
    createAgent: guarded.mutation(() => 'created'),
    getAgents: guarded.query(() => 'agents'),
  }),
  aiChat: trpc.router({
    sendMessage: guarded.mutation(() => 'sent'),
  }),
  apiKey: trpc.router({
    createApiKey: guarded.mutation(() => 'minted'),
  }),
  healthcheck: guarded.query(() => 'ok'),
  unknownNamespace: trpc.router({
    doThing: guarded.mutation(() => 'done'),
  }),
});

const createCaller = createCallerFactory(testRouter);

describe('apiKeyScopeGuard', () => {
  describe('non-API-key auth', () => {
    it('is untouched by the guard', async () => {
      const caller = createCaller({ userId: 'user-1' } as any);

      await expect(caller.agent.createAgent()).resolves.toBe('created');
      await expect(caller.apiKey.createApiKey()).resolves.toBe('minted');
    });
  });

  describe('full-access keys', () => {
    it('legacy NULL scopes pass everywhere', async () => {
      const caller = createCaller({ apiKeyScopes: null, userId: 'user-1' } as any);

      await expect(caller.agent.createAgent()).resolves.toBe('created');
      await expect(caller.apiKey.createApiKey()).resolves.toBe('minted');
    });

    it("explicit ['*'] passes everywhere", async () => {
      const caller = createCaller({ apiKeyScopes: ['*'], userId: 'user-1' } as any);

      await expect(caller.aiChat.sendMessage()).resolves.toBe('sent');
    });
  });

  describe('restricted keys', () => {
    it('allows operations whose scope the key holds', async () => {
      const caller = createCaller({ apiKeyScopes: ['agent:write'], userId: 'user-1' } as any);

      await expect(caller.agent.createAgent()).resolves.toBe('created');
      // write implies read
      await expect(caller.agent.getAgents()).resolves.toBe('agents');
    });

    it('rejects operations whose scope is missing', async () => {
      const caller = createCaller({ apiKeyScopes: ['agent:read'], userId: 'user-1' } as any);

      await expect(caller.agent.createAgent()).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: expect.stringContaining('agent:write'),
      });
    });

    it('rejects money-burning calls without model:invoke', async () => {
      const caller = createCaller({ apiKeyScopes: ['chat:write'], userId: 'user-1' } as any);

      await expect(caller.aiChat.sendMessage()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('always rejects blocked namespaces (key minting)', async () => {
      const caller = createCaller({
        apiKeyScopes: [...(['agent:write', 'chat:write', 'model:invoke'] as string[])],
        userId: 'user-1',
      } as any);

      await expect(caller.apiKey.createApiKey()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('fails closed on unregistered namespaces', async () => {
      const caller = createCaller({ apiKeyScopes: ['agent:write'], userId: 'user-1' } as any);

      await expect(caller.unknownNamespace.doThing()).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('keeps bootstrap namespaces open', async () => {
      const caller = createCaller({ apiKeyScopes: ['agent:read'], userId: 'user-1' } as any);

      await expect(caller.healthcheck()).resolves.toBe('ok');
    });
  });
});
