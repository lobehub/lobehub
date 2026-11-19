// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { DeletedResourceSchema, DeletedResourcesSchema } from '../types/common.type';
import { RoleListSchema, RolePermissionsUpdateResultSchema } from '../types/role.type';
import { RoleService } from './role.service';

// Services return the page's rows and total; the controller adds `hasMore`/`nextCursor`.
const SERVICE_PAGE_FIELDS = { hasMore: true, nextCursor: true } as const;

vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = vi.fn().mockResolvedValue(true);
  },
}));

const now = new Date('2026-01-01T00:00:00.000Z');
const ROLE_ROW = {
  createdAt: now,
  description: null,
  displayName: 'Editor',
  id: 'role-1',
  isActive: true,
  isSystem: false,
  metadata: {},
  name: 'editor',
  updatedAt: now,
  workspaceId: null,
};

/** A `delete(...).where(...).returning(...)` chain resolving to `rows`. */
const deleteReturning = (rows: unknown[]) =>
  vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue(rows) })) }));

const json = (value: unknown) => JSON.parse(JSON.stringify(value));

describe('RoleService response payloads', () => {
  let db: any;

  beforeEach(() => {
    db = {
      delete: deleteReturning([]),
      query: {
        permissions: { findMany: vi.fn().mockResolvedValue([]) },
        roles: {
          findFirst: vi.fn().mockResolvedValue(ROLE_ROW),
          findMany: vi.fn().mockResolvedValue([ROLE_ROW]),
        },
        userRoles: { findFirst: vi.fn().mockResolvedValue(undefined) },
      },
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ count: 1 }]) })),
      })),
    };
    db.transaction = vi.fn((run: (tx: unknown) => unknown) => run(db));
  });

  const service = () => new RoleService(db as LobeChatDatabase, 'user-1');

  it('lists roles as the public projection', async () => {
    const result = await service().getRoles({});

    expect(result.roles[0]).not.toHaveProperty('workspaceId');
    expect(() => RoleListSchema.omit(SERVICE_PAGE_FIELDS).parse(json(result))).not.toThrow();
  });

  it('deletes a role and answers with the deleted id', async () => {
    db.delete = deleteReturning([{ id: 'role-1' }]);

    const result = await service().deleteRole('role-1');

    expect(result).toEqual({ deleted: true, id: 'role-1' });
    expect(() => DeletedResourceSchema.parse(result)).not.toThrow();
  });

  it('clears role permissions and counts the mappings it removed', async () => {
    db.delete = deleteReturning([{ permissionId: 'p-1' }, { permissionId: 'p-2' }]);

    const result = await service().clearRolePermissions('role-1');

    expect(result).toEqual({ count: 2, deleted: true });
    expect(() => DeletedResourcesSchema.parse(result)).not.toThrow();
  });

  it('reports revoked permission mappings in the documented shape', async () => {
    db.delete = deleteReturning([{ permissionId: 'p-1' }]);

    const result = await service().updateRolePermissions('role-1', { revoke: ['p-1'] });

    expect(result).toEqual({ granted: 0, revoked: 1, roleId: 'role-1' });
    expect(() => RolePermissionsUpdateResultSchema.parse(result)).not.toThrow();
  });
});
