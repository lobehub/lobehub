import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { LobeChatDatabase } from '../type';
import { roles, rolePermissions, userRoles } from '../schemas/role';

export class RoleModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  async create(name: string, scope: 'global' | 'workspace' | 'system', description: string | null, permissions: string[] = []) {
    const id = randomUUID();
    const [result] = await this.db.insert(roles).values({ id, name, scope, description }).returning();

    if (permissions.length > 0) {
      const rows = permissions.map((p) => ({ id: randomUUID(), roleId: id, permission: p }));
      await this.db.insert(rolePermissions).values(rows).onConflictDoNothing();
    }

    return result;
  }

  async findById(id: string) {
    return this.db.query.roles.findFirst({ where: sql`roles.id = ${id}` });
  }

  async listRoles(scope?: 'global' | 'workspace' | 'system') {
    if (scope) {
      return this.db.query.roles.findMany({ where: sql`roles.scope = ${scope}` });
    }
    return this.db.query.roles.findMany();
  }

  async update(id: string, payload: { name?: string | null; description?: string | null; permissions?: string[] | null }) {
    const { name, description, permissions } = payload;
    await this.db.update(roles).set({ name: name ?? undefined, description: description ?? undefined }).where(sql`id = ${id}`);

    if (permissions) {
      // replace permissions
      await this.db.delete(rolePermissions).where(sql`role_id = ${id}`);
      if (permissions.length > 0) {
        const rows = permissions.map((p) => ({ id: randomUUID(), roleId: id, permission: p }));
        await this.db.insert(rolePermissions).values(rows).onConflictDoNothing();
      }
    }

    return this.findById(id);
  }

  async delete(id: string) {
    await this.db.delete(roles).where(sql`id = ${id}`);
    return true;
  }

  async assignRoleToUser(userId: string, roleId: string, workspaceId: string | null, assignedBy?: string) {
    const id = randomUUID();
    await this.db.insert(userRoles).values({ id, userId, roleId, workspaceId, assignedBy: assignedBy ?? this.userId }).onConflictDoNothing();
    return true;
  }

  async revokeRoleFromUser(userId: string, roleId: string, workspaceId: string | null) {
    await this.db
      .delete(userRoles)
      .where(sql`user_id = ${userId} AND role_id = ${roleId} AND ${(workspaceId === null ? sql`workspace_id IS NULL` : sql`workspace_id = ${workspaceId}`)}`);

    return true;
  }

  async listUserRoles(userId: string) {
    return this.db.query.userRoles.findMany({ where: sql`user_id = ${userId}` });
  }

  async cloneRole(sourceRoleId: string, newName: string, cloneAssignments = false) {
    const source = await this.findById(sourceRoleId);
    if (!source) throw new Error('ROLE_NOT_FOUND');

    const newRoleId = randomUUID();
    const [newRole] = await this.db.insert(roles).values({ id: newRoleId, name: newName, scope: source.scope, description: source.description }).returning();

    // clone permissions
    const perms = await this.db.query.rolePermissions.findMany({ where: sql`role_id = ${sourceRoleId}` });
    if (perms.length > 0) {
      const rows = perms.map((p) => ({ id: randomUUID(), roleId: newRoleId, permission: p.permission }));
      await this.db.insert(rolePermissions).values(rows).onConflictDoNothing();
    }

    if (cloneAssignments) {
      const assignments = await this.db.query.userRoles.findMany({ where: sql`role_id = ${sourceRoleId}` });
      if (assignments.length > 0) {
        const rows = assignments.map((a) => ({ id: randomUUID(), userId: a.userId, roleId: newRoleId, workspaceId: a.workspaceId, assignedBy: this.userId }));
        await this.db.insert(userRoles).values(rows).onConflictDoNothing();
      }
    }

    return newRole;
  }
}
