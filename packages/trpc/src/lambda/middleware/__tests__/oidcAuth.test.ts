import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { trpc } from '@/libs/trpc/lambda/init';

import { oidcAuth } from '../oidcAuth';

// Minimal router that exercises oidcAuth
const testRouter = trpc.router({
  ping: trpc.procedure.use(oidcAuth).query(({ ctx }) => ctx.userId ?? null),
});

const createCaller = createCallerFactory(testRouter);

describe('oidcAuth middleware', () => {
  it('sets userId from sub when oidcAuth is a normal token', async () => {
    const caller = createCaller({
      oidcAuth: { purpose: 'cli-sandbox', sub: 'user-abc' },
    } as any);

    const result = await caller.ping();

    expect(result).toBe('user-abc');
  });

  it('sets userId when oidcAuth has no purpose field (standard OIDC token)', async () => {
    const caller = createCaller({
      oidcAuth: { sub: 'user-abc' },
    } as any);

    const result = await caller.ping();

    expect(result).toBe('user-abc');
  });

  it('passes through with null userId when oidcAuth is absent', async () => {
    const caller = createCaller({} as any);

    const result = await caller.ping();

    expect(result).toBeNull();
  });

  it('rejects hetero-operation tokens to block misuse on normal authed routes', async () => {
    const caller = createCaller({
      oidcAuth: { purpose: 'hetero-operation', sub: 'user-abc' },
    } as any);

    await expect(caller.ping()).rejects.toThrow(TRPCError);
    await expect(caller.ping()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});
