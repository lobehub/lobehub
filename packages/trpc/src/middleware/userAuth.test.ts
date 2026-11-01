import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { type AuthContext } from '@/libs/trpc/lambda/context';
import { createContextInner } from '@/libs/trpc/lambda/context';

import { trpc } from '../lambda/init';
import { userAuth } from './userAuth';

const appRouter = trpc.router({
  protectedQuery: trpc.procedure.use(userAuth).query(async ({ ctx }) => {
    return ctx.userId;
  }),
});

const createCaller = createCallerFactory(appRouter);
let ctx: AuthContext;
let router: ReturnType<typeof createCaller>;

beforeEach(async () => {
  vi.resetAllMocks();
});

describe('userAuth middleware', () => {
  it('should throw UNAUTHORIZED error if userId is not present in context', async () => {
    ctx = await createContextInner();
    router = createCaller(ctx);

    try {
      await router.protectedQuery();
    } catch (e) {
      expect(e).toEqual(new TRPCError({ code: 'UNAUTHORIZED' }));
    }
  });

  it('should call next with userId in context if userId is present', async () => {
    ctx = await createContextInner({ userId: 'user-id' });
    router = createCaller(ctx);

    const data = await router.protectedQuery();

    expect(data).toEqual('user-id');
  });
});
