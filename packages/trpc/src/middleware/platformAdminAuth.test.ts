import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { type AuthContext, createContextInner } from '@/libs/trpc/lambda/context';

import { trpc } from '../lambda/init';
import { platformAdminAuth } from './platformAdminAuth';

const appRouter = trpc.router({
  protectedQuery: trpc.procedure.use(platformAdminAuth).query(async ({ ctx }) => {
    return ctx.adminId;
  }),
});

const createCaller = createCallerFactory(appRouter);
let ctx: AuthContext;
let router: ReturnType<typeof createCaller>;

beforeEach(async () => {
  vi.resetAllMocks();
});

describe('platformAdminAuth middleware', () => {
  it('throws UNAUTHORIZED when adminId is missing', async () => {
    ctx = await createContextInner({ userId: 'chat-user' });
    router = createCaller(ctx);

    await expect(router.protectedQuery()).rejects.toEqual(new TRPCError({ code: 'UNAUTHORIZED' }));
  });

  it('passes adminId through when present', async () => {
    ctx = await createContextInner({ adminId: 'opusr_1' });
    router = createCaller(ctx);

    await expect(router.protectedQuery()).resolves.toEqual('opusr_1');
  });
});
