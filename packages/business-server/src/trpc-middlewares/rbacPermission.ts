import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';

import { getServerDB } from '@/database/core/db-adaptor';
import { workspaceMembers } from '@/database/schemas';
import { trpc } from '@/libs/trpc/lambda/init';

const OWNER_ACTIONS = new Set(['create', 'delete', 'update', 'manage', 'transfer']);

const requiresOwner = (code: string) => {
  const action = code.split(':').at(-1) ?? '';
  return OWNER_ACTIONS.has(action);
};

const assertPermission = async (params: {
  code: string;
  userId?: string | null;
  workspaceId?: string | null;
}) => {
  if (!params.workspaceId) return;
  if (!params.userId) throw new TRPCError({ code: 'UNAUTHORIZED' });

  const db = await getServerDB();
  const membership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, params.workspaceId),
      eq(workspaceMembers.userId, params.userId),
      isNull(workspaceMembers.deletedAt),
    ),
  });

  if (!membership) throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа к workspace' });
  if (requiresOwner(params.code) && membership.role !== 'owner') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Требуется роль владельца workspace' });
  }
};

export const withRbacPermission = (code: string) =>
  trpc.middleware(async (opts) => {
    await assertPermission({ code, userId: opts.ctx.userId, workspaceId: opts.ctx.workspaceId });

    return opts.next();
  });

export const withAnyRbacPermission = (codes: string[]) =>
  trpc.middleware(async (opts) => {
    let lastError: unknown;
    for (const code of codes) {
      try {
        await assertPermission({
          code,
          userId: opts.ctx.userId,
          workspaceId: opts.ctx.workspaceId,
        });
        return opts.next();
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  });

export const withAllRbacPermissions = (codes: string[]) =>
  trpc.middleware(async (opts) => {
    for (const code of codes) {
      await assertPermission({ code, userId: opts.ctx.userId, workspaceId: opts.ctx.workspaceId });
    }

    return opts.next();
  });

/**
 * Sugar for the "member-or-owner" gate — in cloud this fans the action code
 * out into the `:all | :owner` scope pair so a member with the `:owner` grant
 * passes alongside an owner with the `:all` grant. OSS no-op.
 */
export const withScopedPermission = (action: string) => withRbacPermission(action);
