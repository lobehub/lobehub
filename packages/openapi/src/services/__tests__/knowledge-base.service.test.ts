import { describe, expect, it, vi } from 'vitest';

import { DeletedResourceSchema } from '../../types/common.type';
import {
  KnowledgeBaseDetailResponseSchema,
  KnowledgeBaseListResponseSchema,
} from '../../types/knowledge-base.type';
import { KnowledgeBaseService } from '../knowledge-base.service';

// Services return the page's rows and total; the controller adds `hasMore`/`nextCursor`.
const SERVICE_PAGE_FIELDS = { hasMore: true, nextCursor: true } as const;

const { deleteWithFilesMock, deleteFilesMock, findByIdMock } = vi.hoisted(() => ({
  deleteFilesMock: vi.fn(),
  deleteWithFilesMock: vi.fn(),
  findByIdMock: vi.fn(),
}));

vi.mock('@/database/models/rbac', () => ({ RbacModel: class {} }));
vi.mock('@/database/models/knowledgeBase', () => ({
  KnowledgeBaseModel: class {
    deleteWithFiles = deleteWithFilesMock;
    findById = findByIdMock;
  },
}));
vi.mock('@/server/services/file', () => ({
  FileService: class {
    deleteFiles = deleteFilesMock;
  },
}));

/** A full `knowledge_bases` row, private columns included. */
const knowledgeBaseRow = {
  accessedAt: new Date('2024-01-03T00:00:00Z'),
  avatar: null,
  clientId: null,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  deletedAt: null,
  deletedBy: null,
  description: 'Docs',
  id: 'kb-1',
  isPublic: false,
  name: 'Docs',
  settings: null,
  type: null,
  updatedAt: new Date('2024-01-02T00:00:00Z'),
  userId: 'user-1',
  visibility: 'public',
  workspaceId: null,
};

const buildService = (db: unknown = {}) => {
  const service = new KnowledgeBaseService(db as any, 'user-1') as any;
  service.resolveOperationPermission = vi.fn().mockResolvedValue({ isPermitted: true });
  return service;
};

// A JSON round-trip on purpose: `structuredClone` would keep the `Date` objects.
// oxlint-disable-next-line unicorn/prefer-structured-clone
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value));

describe('KnowledgeBaseService response payloads', () => {
  // Regression: DELETE /knowledge-bases/:id answered `{ success, message }`
  // instead of naming the knowledge base it removed.
  it('reports the deleted knowledge base id', async () => {
    deleteWithFilesMock.mockResolvedValue({ deletedFiles: [{ id: 'f', url: 'files/f' }] });
    const db = {
      query: { knowledgeBases: { findFirst: vi.fn().mockResolvedValue(knowledgeBaseRow) } },
    };

    const result = await buildService(db).deleteKnowledgeBase('kb-1');

    expect(result).toEqual({ deleted: true, id: 'kb-1' });
    expect(deleteFilesMock).toHaveBeenCalledWith(['files/f']);
    expect(() => DeletedResourceSchema.parse(result)).not.toThrow();
  });

  it('returns only the public knowledge base columns in a detail', async () => {
    findByIdMock.mockResolvedValue(knowledgeBaseRow);

    const result = asJson(await buildService().getKnowledgeBaseDetail('kb-1'));

    expect(() => KnowledgeBaseDetailResponseSchema.parse(result)).not.toThrow();
    expect(result.knowledgeBase).not.toHaveProperty('userId');
  });

  it('matches the documented list payload', async () => {
    const chain = { from: () => ({ where: () => Promise.resolve([{ count: 1 }]) }) };
    const db = {
      query: { knowledgeBases: { findMany: vi.fn().mockResolvedValue([knowledgeBaseRow]) } },
      select: () => chain,
    };

    const result = asJson(await buildService(db).getKnowledgeBaseList({}));

    expect(() =>
      KnowledgeBaseListResponseSchema.omit(SERVICE_PAGE_FIELDS).parse(result),
    ).not.toThrow();
    expect(result.knowledgeBases[0].accessType).toBe('owner');
  });
});
