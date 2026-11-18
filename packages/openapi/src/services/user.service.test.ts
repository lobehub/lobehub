// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { DeletedResourceSchema, DeletedResourcesSchema } from '../types/common.type';
import { UserRoleSchema, UserSchema } from '../types/user.type';
import { UserService } from './user.service';

const deleteUserMock = vi.hoisted(() => vi.fn());

vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = vi.fn().mockResolvedValue(true);
  },
}));
vi.mock('@/database/models/user', () => ({ UserModel: { deleteUser: deleteUserMock } }));

const now = new Date('2026-01-01T00:00:00.000Z');
const USER_ROW = {
  avatar: null,
  createdAt: now,
  email: 'someone@example.com',
  firstName: null,
  fullName: 'Someone',
  id: 'user-1',
  isOnboarded: true,
  lastName: null,
  phone: null,
  preference: { language: 'en-US' },
  updatedAt: now,
  username: 'someone',
};
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

const json = (value: unknown) => JSON.parse(JSON.stringify(value));

/** A select chain (`from` / `innerJoin` / `where`) that resolves to `rows`. */
const selectResolving = (rows: unknown[]) => {
  const chain: any = {};
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn().mockResolvedValue(rows);
  return vi.fn(() => chain);
};

describe('UserService response payloads', () => {
  let db: any;

  beforeEach(() => {
    deleteUserMock.mockReset();
    db = {
      delete: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([{ id: 'assignment-1' }, { id: 'assignment-2' }]),
        })),
      })),
      query: { users: { findFirst: vi.fn().mockResolvedValue(USER_ROW) } },
      select: selectResolving([{ roles: ROLE_ROW }]),
    };
  });

  const service = () => new UserService(db as LobeChatDatabase, 'user-1');

  it('returns a user as the public projection with roles', async () => {
    const user = await service().getUserById('user-1');

    expect(user).not.toHaveProperty('preference');
    expect(() => UserSchema.parse(json(user))).not.toThrow();
  });

  it('returns user role assignments in the documented shape', async () => {
    db.select = selectResolving([{ role: ROLE_ROW, userRole: { expiresAt: null } }]);

    const roles = await service().getUserRoles('user-1');

    expect(() => UserRoleSchema.array().parse(json(roles))).not.toThrow();
  });

  it('deletes a user and answers with the deleted id', async () => {
    deleteUserMock.mockResolvedValue({ rowCount: 1 });

    const result = await service().deleteUser('user-1');

    expect(result).toEqual({ deleted: true, id: 'user-1' });
    expect(() => DeletedResourceSchema.parse(result)).not.toThrow();
  });

  it('clears user roles and counts the assignments it removed', async () => {
    const result = await service().clearUserRoles('user-1');

    expect(result).toEqual({ count: 2, deleted: true });
    expect(() => DeletedResourcesSchema.parse(result)).not.toThrow();
  });
});
