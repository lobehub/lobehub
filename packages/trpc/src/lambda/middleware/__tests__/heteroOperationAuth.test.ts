import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { trpc } from '@/libs/trpc/lambda/init';

import { heteroOperationAuth } from '../heteroOperationAuth';

// Minimal router that exercises heteroOperationAuth
const testRouter = trpc.router({
  ping: trpc.procedure.use(heteroOperationAuth).query(({ ctx }) => ctx.userId),
});

const createCaller = createCallerFactory(testRouter);

describe('heteroOperationAuth middleware', () => {
  it('passes through and exposes userId when purpose is hetero-operation', async () => {
    const caller = createCaller({
      oidcAuth: { purpose: 'hetero-operation', sub: 'user-abc' },
    } as any);

    const result = await caller.ping();

    expect(result).toBe('user-abc');
  });

  it('rejects when oidcAuth is absent', async () => {
    const caller = createCaller({} as any);

    await expect(caller.ping()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('rejects a cli-sandbox token (wrong purpose)', async () => {
    const caller = createCaller({
      oidcAuth: { purpose: 'cli-sandbox', sub: 'user-abc' },
    } as any);

    await expect(caller.ping()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('rejects when purpose is undefined', async () => {
    const caller = createCaller({
      oidcAuth: { sub: 'user-abc' },
    } as any);

    await expect(caller.ping()).rejects.toThrow(TRPCError);
  });
});
