import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';

import { RoleModel } from '@/database/models/role';

const adminProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({ ctx: { roleModel: new RoleModel(ctx.serverDB, ctx.userId) } });
});

export const adminRolesRouter = router({
  listRoles: adminProcedure.query(async ({ ctx }) => {
    const roles = await ctx.roleModel.listRoles();
    return { data: roles, success: true };
  }),

  getRole: adminProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const role = await ctx.roleModel.findById(input.id);
    if (!role) throw new Error('ROLE_NOT_FOUND');
    return { data: role, success: true };
  }),

  createRole: adminProcedure
    .use(withScopedPermission('rbac:role_create'))
    .input(z.object({ name: z.string(), scope: z.enum(['global', 'workspace', 'system']), description: z.string().optional(), permissions: z.array(z.string()).optional() }))
    .mutation(async ({ ctx, input }) => {
      const role = await ctx.roleModel.create(input.name, input.scope, input.description ?? null, input.permissions ?? []);
      return { data: role, success: true };
    }),

  updateRole: adminProcedure
    .use(withScopedPermission('rbac:role_update'))
    .input(z.object({ id: z.string(), name: z.string().optional(), description: z.string().optional(), permissions: z.array(z.string()).optional() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.roleModel.update(input.id, { name: input.name, description: input.description, permissions: input.permissions });
      return { data: updated, success: true };
    }),

  deleteRole: adminProcedure
    .use(withScopedPermission('rbac:role_delete'))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.roleModel.delete(input.id);
      return { success: true };
    }),

  assignRoleToUser: adminProcedure
    .use(withScopedPermission('rbac:user_role_update'))
    .input(z.object({ userId: z.string(), roleId: z.string(), workspaceId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.roleModel.assignRoleToUser(input.userId, input.roleId, input.workspaceId ?? null, ctx.userId);
      return { success: true };
    }),

  revokeRoleFromUser: adminProcedure
    .use(withScopedPermission('rbac:user_role_delete'))
    .input(z.object({ userId: z.string(), roleId: z.string(), workspaceId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.roleModel.revokeRoleFromUser(input.userId, input.roleId, input.workspaceId ?? null);
      return { success: true };
    }),
});
