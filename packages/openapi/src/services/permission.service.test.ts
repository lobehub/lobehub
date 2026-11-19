// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { DeletedResourceSchema } from '../types/common.type';
import { PermissionListSchema, PermissionSchema } from '../types/permission.type';
import { PermissionService } from './permission.service';

// Services return the page's rows and total; the controller adds `hasMore`/`nextCursor`.
const SERVICE_PAGE_FIELDS = { hasMore: true, nextCursor: true } as const;

vi.mock('@/database/models/rbac', () => ({ RbacModel: class {} }));

const now = new Date('2026-01-01T00:00:00.000Z');
const PERMISSION_ROW = {
  category: 'agent',
  code: 'agent:read:all',
  createdAt: now,
  description: null,
  id: 'perm-0000000001',
  isActive: true,
  name: 'Read agents',
  updatedAt: now,
};

const json = (value: unknown) => JSON.parse(JSON.stringify(value));

describe('PermissionService response payloads', () => {
  let db: any;

  beforeEach(() => {
    db = {
      delete: vi.fn(() => ({
        where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([{ id: PERMISSION_ROW.id }]) })),
      })),
      query: {
        permissions: {
          findFirst: vi.fn().mockResolvedValue(PERMISSION_ROW),
          findMany: vi.fn().mockResolvedValue([PERMISSION_ROW]),
        },
        rolePermissions: { findFirst: vi.fn().mockResolvedValue(undefined) },
      },
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ count: 1 }]) })),
      })),
    };
  });

  const service = () => new PermissionService(db as LobeChatDatabase, 'user-1');

  it('returns permissions in the documented shapes', async () => {
    const list = await service().getPermissions({});
    const detail = await service().getPermissionById(PERMISSION_ROW.id);

    expect(() => PermissionListSchema.omit(SERVICE_PAGE_FIELDS).parse(json(list))).not.toThrow();
    expect(() => PermissionSchema.parse(json(detail))).not.toThrow();
  });

  it('deletes a permission and answers with the deleted id', async () => {
    const result = await service().deletePermission(PERMISSION_ROW.id);

    expect(result).toEqual({ deleted: true, id: PERMISSION_ROW.id });
    expect(() => DeletedResourceSchema.parse(result)).not.toThrow();
  });
});
