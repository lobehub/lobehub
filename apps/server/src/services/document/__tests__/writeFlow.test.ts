import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getResourceMeta, type ResourceMeta } from '@/server/services/resourcePermission';

import { createDocumentFromInput, type DocumentWriteContext } from '../writeFlow';

vi.mock('@/business/server/document-mention/notifyActivity', () => ({
  notifyDocumentMention: vi.fn(),
}));
vi.mock('@/server/services/knowledgeBaseAccess', () => ({
  assertContentsNotInRestrictedKnowledgeBase: vi.fn(),
}));
vi.mock('@/server/services/resourcePermission', () => ({ getResourceMeta: vi.fn() }));
vi.mock('@/database/models/resourcePermission', () => ({
  ResourcePermissionModel: class {
    setAccessLevel = vi.fn();
  },
}));
vi.mock('../editorData', () => ({
  resolveDocumentWrite: async ({ content }: { content?: string }) => ({
    content,
    editorData: content === undefined ? undefined : { root: {} },
  }),
}));

const buildContext = (workspaceId?: string) => {
  const createDocument = vi.fn(async (params: { parentId?: string; title: string }) => ({
    id: 'doc-new',
    parentId: params.parentId ?? null,
    title: params.title,
    visibility: 'private',
  }));
  const findBySlug = vi.fn(async (slug: string) =>
    slug === 'meeting-minutes' ? { id: 'folder-id' } : undefined,
  );
  const ctx = {
    documentModel: { findBySlug },
    documentService: { createDocument },
    serverDB: {},
    userId: 'user-1',
    workspaceId,
  } as unknown as DocumentWriteContext;

  return { createDocument, ctx };
};

describe('createDocumentFromInput', () => {
  beforeEach(() => {
    vi.mocked(getResourceMeta).mockReset();
  });

  it('creates inside a folder addressed by its slug', async () => {
    const { createDocument, ctx } = buildContext();

    await createDocumentFromInput(ctx, {
      content: '# Weekly sync',
      parentId: 'meeting-minutes',
      title: 'Weekly sync',
    });

    expect(createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ editorData: { root: {} }, parentId: 'folder-id' }),
    );
  });

  it('creates inside a folder addressed by its id', async () => {
    const { createDocument, ctx } = buildContext();

    await createDocumentFromInput(ctx, { parentId: 'folder-id', title: 'Weekly sync' });

    expect(createDocument).toHaveBeenCalledWith(expect.objectContaining({ parentId: 'folder-id' }));
  });

  it('refuses a workspace parent the caller cannot see, before writing', async () => {
    const { createDocument, ctx } = buildContext('ws-1');
    vi.mocked(getResourceMeta).mockResolvedValue({
      userId: 'someone-else',
      visibility: 'private',
      workspaceId: 'ws-1',
    } satisfies ResourceMeta);

    await expect(
      createDocumentFromInput(ctx, { parentId: 'folder-id', title: 'Weekly sync' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(createDocument).not.toHaveBeenCalled();
  });
});
