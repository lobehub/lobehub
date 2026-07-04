import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';

import { RoleModel } from '@/database/models/role';
import { AuditModel } from '@/database/models/audit';

const adminProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({ ctx: { roleModel: new RoleModel(ctx.serverDB, ctx.userId), auditModel: new AuditModel(ctx.serverDB), userId: ctx.userId } });
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
      // audit
      try {
        await ctx.auditModel.log({
          actorId: ctx.userId,
          action: 'role.create',
          targetType: 'role',
          targetId: role.id,
          details: { name: input.name, scope: input.scope },
        });
      } catch (e) {
        // don't fail the main operation if audit logging fails
        console.error('audit log failed', e);
      }
      return { data: role, success: true };
    }),

  updateRole: adminProcedure
    .use(withScopedPermission('rbac:role_update'))
    .input(z.object({ id: z.string(), name: z.string().optional(), description: z.string().optional(), permissions: z.array(z.string()).optional() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.roleModel.update(input.id, { name: input.name, description: input.description, permissions: input.permissions });
      try {
        await ctx.auditModel.log({
          actorId: ctx.userId,
          action: 'role.update',
          targetType: 'role',
          targetId: input.id,
          details: { name: input.name ?? undefined, description: input.description ?? undefined, permissionsChanged: Array.isArray(input.permissions) },
        });
      } catch (e) {
        console.error('audit log failed', e);
      }
      return { data: updated, success: true };
    }),

  deleteRole: adminProcedure
    .use(withScopedPermission('rbac:role_delete'))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.roleModel.delete(input.id);
      try {
        await ctx.auditModel.log({
          actorId: ctx.userId,
          action: 'role.delete',
          targetType: 'role',
          targetId: input.id,
        });
      } catch (e) {
        console.error('audit log failed', e);
      }
      return { success: true };
    }),

  assignRoleToUser: adminProcedure
    .use(withScopedPermission('rbac:user_role_update'))
    .input(z.object({ userId: z.string(), roleId: z.string(), workspaceId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.roleModel.assignRoleToUser(input.userId, input.roleId, input.workspaceId ?? null, ctx.userId);
      try {
        await ctx.auditModel.log({
          actorId: ctx.userId,
          action: 'role.assign',
          targetType: 'role',
          targetId: input.roleId,
          subjectUserId: input.userId,
          workspaceId: input.workspaceId ?? null,
        });
      } catch (e) {
        console.error('audit log failed', e);
      }
      return { success: true };
    }),

  revokeRoleFromUser: adminProcedure
    .use(withScopedPermission('rbac:user_role_delete'))
    .input(z.object({ userId: z.string(), roleId: z.string(), workspaceId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.roleModel.revokeRoleFromUser(input.userId, input.roleId, input.workspaceId ?? null);
      try {
        await ctx.auditModel.log({
          actorId: ctx.userId,
          action: 'role.revoke',
          targetType: 'role',
          targetId: input.roleId,
          subjectUserId: input.userId,
          workspaceId: input.workspaceId ?? null,
        });
      } catch (e) {
        console.error('audit log failed', e);
      }
      return { success: true };
    }),

  cloneRole: adminProcedure
    .use(withScopedPermission('rbac:role_create'))
    .input(z.object({ sourceRoleId: z.string(), newName: z.string(), cloneAssignments: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const newRole = await ctx.roleModel.cloneRole(input.sourceRoleId, input.newName, !!input.cloneAssignments);
      try {
        await ctx.auditModel.log({
          actorId: ctx.userId,
          action: 'role.clone',
          targetType: 'role',
          targetId: newRole.id,
          details: { sourceRoleId: input.sourceRoleId, cloneAssignments: !!input.cloneAssignments },
        });
      } catch (e) {
        console.error('audit log failed', e);
      }
      return { data: newRole, success: true };
    }),
});
