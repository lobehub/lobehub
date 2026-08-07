import { describe, expect, it } from 'vitest';

import { createCallerFactory, publicProcedure } from '@/libs/trpc/lambda';
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
  agentDocument: trpc.router({
    // carries a procedure-level extra scope (model:invoke) on top of knowledge:write
    generateSkillMeta: guarded.mutation(() => 'meta'),
  }),
  aiChat: trpc.router({
    sendMessage: guarded.mutation(() => 'sent'),
  }),
  apiKey: trpc.router({
    createApiKey: guarded.mutation(() => 'minted'),
  }),
  healthcheck: guarded.query(() => 'ok'),
  // public procedures can still serve authenticated data off ctx.userId, so
  // the real `publicProcedure` must carry the guard as well
  message: trpc.router({
    getMessages: publicProcedure.query(() => 'messages'),
  }),
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

    it('requires procedure-level extra scopes on top of the namespace scope', async () => {
      const withoutInvoke = createCaller({ apiKeyScopes: ['knowledge:write'], userId: 'u' } as any);
      await expect(withoutInvoke.agentDocument.generateSkillMeta()).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: expect.stringContaining('model:invoke'),
      });

      const withBoth = createCaller({
        apiKeyScopes: ['knowledge:write', 'model:invoke'],
        userId: 'u',
      } as any);
      await expect(withBoth.agentDocument.generateSkillMeta()).resolves.toBe('meta');
    });

    it('keeps bootstrap namespaces open', async () => {
      const caller = createCaller({ apiKeyScopes: ['agent:read'], userId: 'user-1' } as any);

      await expect(caller.healthcheck()).resolves.toBe('ok');
    });
  });

  describe('publicProcedure', () => {
    it('anonymous access is untouched', async () => {
      const caller = createCaller({} as any);

      await expect(caller.message.getMessages()).resolves.toBe('messages');
    });

    it('enforces scopes for API-key-authenticated calls', async () => {
      const caller = createCaller({ apiKeyScopes: ['agent:read'], userId: 'user-1' } as any);

      await expect(caller.message.getMessages()).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: expect.stringContaining('chat:read'),
      });
    });

    it('allows API-key calls holding the required scope', async () => {
      const caller = createCaller({ apiKeyScopes: ['chat:read'], userId: 'user-1' } as any);

      await expect(caller.message.getMessages()).resolves.toBe('messages');
    });
  });
});
