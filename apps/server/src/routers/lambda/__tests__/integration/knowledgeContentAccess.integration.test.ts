// @vitest-environment node
import * as business from '@lobechat/business-knowledge';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/(backend)/f/[id]/route';
import { createPGlite, readPGliteSnapshot } from '@/database/core/pgliteSnapshot';
import * as schema from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { KnowledgeBaseSearchService } from '@/server/services/knowledgeBase';
import { attachmentsRuntime } from '@/server/services/toolExecution/serverRuntimes/attachments';
import { knowledgeBaseRuntime } from '@/server/services/toolExecution/serverRuntimes/knowledgeBase';

import { chunkRouter } from '../../chunk';

const boundary = vi.hoisted(() => ({
  db: undefined as LobeChatDatabase | undefined,
  identity: undefined as string | undefined,
  credential: {} as Record<string, unknown>,
  sign: vi.fn(async () => 'https://storage.example/temporary'),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => boundary.db }));
vi.mock('@/database/server', () => ({ getServerDB: () => boundary.db }));
vi.mock('@/libs/trpc/lambda/context', () => ({
  createLambdaContext: vi.fn(async () => ({ userId: boundary.identity, ...boundary.credential })),
}));
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return { createCachedPreSignedUrlForPreview: boundary.sign, createDownloadUrl: boundary.sign };
  }),
}));
vi.mock('@lobechat/business-knowledge', async (original) => ({
  ...(await original<typeof business>()),
  isEnterpriseKnowledgeEnabled: vi.fn(() => false),
  listEnterpriseKbIds: vi.fn(),
  resolveEnterpriseKbAccess: vi.fn(),
}));
vi.mock('@/server/services/workspacePermission', () => ({
  getWorkspaceScopedPermissionMatches: vi.fn(async () => ({
    hasAllScope: false,
    hasOwnerScope: true,
  })),
}));

let client: ReturnType<typeof createPGlite>;
let db: LobeChatDatabase;
const owner = 'content-owner';
const viewer = 'content-viewer';
const outsider = 'content-outsider';
const caller = (userId?: string, workspaceId?: string) =>
  chunkRouter.createCaller({ userId, workspaceId });
const contents = (userId: string, ids: string[], workspaceId?: string) =>
  caller(userId, workspaceId).getFileContents({ fileIds: ids });
const proxy = (id: string, download = false) =>
  GET(new Request(`https://app.example/f/${id}${download ? '?download=1' : ''}`), {
    params: Promise.resolve({ id }),
  });

const enablePolicy = () => {
  vi.mocked(business.isEnterpriseKnowledgeEnabled).mockReturnValue(true);
  vi.mocked(business.listEnterpriseKbIds).mockImplementation(async (_db, ids) =>
    (ids ?? ['content-kb-a', 'content-kb-b']).filter(
      (id) => id === 'content-kb-a' || id === 'content-kb-b',
    ),
  );
  vi.mocked(business.resolveEnterpriseKbAccess).mockImplementation(
    async (_db, userId, knowledgeBaseId) => ({
      enterprise: true,
      access:
        userId === owner || (userId === viewer && knowledgeBaseId === 'content-kb-a')
          ? { knowledgeBaseId, ownerId: owner, level: userId === owner ? 'owner' : 'view' }
          : null,
    }),
  );
};

beforeAll(async () => {
  client = createPGlite(readPGliteSnapshot());
  db = drizzle({ client, schema }) as unknown as LobeChatDatabase;
  boundary.db = db;
  await db.insert(schema.users).values([owner, viewer, outsider].map((id) => ({ id })));
  await db.insert(schema.workspaces).values({
    id: 'content-workspace',
    name: 'Content workspace',
    slug: 'content-workspace',
    primaryOwnerId: owner,
  });
  await db.insert(schema.knowledgeBases).values([
    { id: 'content-kb-a', name: 'Library A', userId: owner },
    { id: 'content-kb-b', name: 'Library B', userId: owner },
    {
      id: 'content-kb-workspace',
      name: 'Restricted library',
      userId: owner,
      workspaceId: 'content-workspace',
    },
  ]);
  await db.insert(schema.files).values(
    [
      { id: 'file_content_a', userId: owner },
      { id: 'file_content_b', userId: owner },
      { id: 'file_content_personal', userId: owner },
      { id: 'file_content_deleted', userId: owner, isDeleted: true },
      { id: 'file_content_workspace', userId: owner, workspaceId: 'content-workspace' },
    ].map((file) => ({
      ...file,
      fileType: 'text/plain',
      name: `${file.id}.txt`,
      size: 10,
      url: `storage/${file.id}`,
    })),
  );
  await db.insert(schema.knowledgeBaseFiles).values([
    { fileId: 'file_content_a', knowledgeBaseId: 'content-kb-a', userId: owner },
    { fileId: 'file_content_b', knowledgeBaseId: 'content-kb-b', userId: owner },
    { fileId: 'file_content_deleted', knowledgeBaseId: 'content-kb-a', userId: owner },
    { fileId: 'file_content_workspace', knowledgeBaseId: 'content-kb-workspace', userId: owner },
  ]);
  await db.insert(schema.documents).values(
    [
      {
        id: 'docs_content_a',
        userId: owner,
        knowledgeBaseId: 'content-kb-a',
        content: 'library A text',
      },
      {
        id: 'docs_content_b',
        userId: owner,
        knowledgeBaseId: 'content-kb-b',
        content: 'library B text',
      },
      {
        id: 'docs_content_parsed',
        userId: owner,
        fileId: 'file_content_a',
        content: 'parsed library A',
      },
      { id: 'docs_content_personal', userId: owner, content: 'personal text' },
      { id: 'docs_content_viewer', userId: viewer, content: 'viewer text' },
      {
        id: 'docs_content_deleted',
        userId: owner,
        knowledgeBaseId: 'content-kb-a',
        content: 'deleted text',
        isDeleted: true,
      },
      {
        id: 'docs_content_deleted_backing',
        userId: owner,
        fileId: 'file_content_deleted',
        content: 'parsed deleted text',
      },
      {
        id: 'docs_content_workspace',
        userId: owner,
        fileId: 'file_content_workspace',
        content: 'restricted text',
        workspaceId: 'content-workspace',
      },
    ].map((doc) => ({
      ...doc,
      fileType: 'text/plain',
      source: 'test',
      sourceType: 'file' as const,
      totalCharCount: 10,
      totalLineCount: 1,
    })),
  );
  await db.insert(schema.resourcePermissions).values({
    workspaceId: 'content-workspace',
    resourceType: 'knowledgeBase',
    resourceId: 'content-kb-workspace',
    accessLevel: 'use',
  });
}, 30000);

afterAll(async () => {
  await client?.close();
});
beforeEach(() => {
  vi.clearAllMocks();
  boundary.credential = {};
  boundary.identity = undefined;
  vi.mocked(business.isEnterpriseKnowledgeEnabled).mockReturnValue(false);
});

describe('knowledge content read boundaries', () => {
  it('preserves default anonymous public-by-id preview and download', async () => {
    for (const download of [false, true]) {
      const response = await proxy('file_content_personal', download);
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('https://storage.example/temporary');
    }
  });

  it('keeps ordinary personal reads owner-scoped, including mixed ids and deleted content', async () => {
    const result = await contents(owner, [
      'docs_content_personal',
      'file_content_a',
      'docs_content_deleted',
    ]);
    expect(result.map((row) => row.content)).toEqual(['personal text', 'parsed library A', '']);
    expect(
      (await contents(viewer, ['docs_content_personal', 'file_content_a'])).every(
        (row) => row.content === '',
      ),
    ).toBe(true);
  });

  it.each([false, true])(
    'does not return ordinary owner content to a different explicit caller (policy enabled: %s)',
    async (policyEnabled) => {
      if (policyEnabled) enablePolicy();
      const result = await new KnowledgeBaseSearchService(
        db,
        owner,
        undefined,
        undefined,
        viewer,
      ).getFileContents(['docs_content_personal']);
      expect(result[0].content).toBe('');
      expect(result[0].error).toBe('Document not found');
    },
  );

  it.each([false, true])(
    'reads ordinary content in the explicit caller scope (policy enabled: %s)',
    async (policyEnabled) => {
      if (policyEnabled) enablePolicy();
      const result = await new KnowledgeBaseSearchService(
        db,
        owner,
        undefined,
        undefined,
        viewer,
      ).getFileContents(['docs_content_viewer']);
      expect(result[0].content).toBe('viewer text');
    },
  );

  it.each([false, true])(
    'preserves ordinary owner reads without an explicit caller (policy enabled: %s)',
    async (policyEnabled) => {
      if (policyEnabled) enablePolicy();
      const result = await new KnowledgeBaseSearchService(db, owner).getFileContents([
        'docs_content_personal',
        'docs_content_viewer',
      ]);
      expect(result.map((row) => row.content)).toEqual(['personal text', '']);
    },
  );

  it('permits a current viewer to read only exact granted items and their parsed pages', async () => {
    enablePolicy();
    const result = await contents(viewer, [
      'docs_content_viewer',
      'docs_content_a',
      'file_content_a',
      'docs_content_parsed',
    ]);
    expect(result.map((row) => row.content)).toEqual([
      'viewer text',
      'library A text',
      'parsed library A',
      'parsed library A',
    ]);
  });

  it('server tool runtimes read managed content as the executing user, not as anonymous', async () => {
    enablePolicy();
    const context = { serverDB: db, userId: viewer } as any;
    const knowledge = (await knowledgeBaseRuntime.factory(context)) as any;
    const attachments = (await attachmentsRuntime.factory(context)) as any;
    const read = await knowledge.readKnowledge({ fileIds: ['file_content_a'] });
    expect(read.success).toBe(true);
    expect(read.content).toContain('parsed library A');
    const attachment = await attachments.readAttachment({ fileId: 'file_content_a' });
    expect(attachment.success).toBe(true);
    expect(attachment.content).toContain('parsed library A');
    const visitor = (await attachmentsRuntime.factory({
      ...context,
      agentShareVisitor: { shareId: 'share' },
    })) as any;
    expect((await visitor.readAttachment({ fileId: 'file_content_a' })).success).toBe(false);
  });

  it('rejects a whole mixed batch when any enterprise item is denied', async () => {
    enablePolicy();
    await expect(contents(viewer, ['docs_content_a', 'file_content_b'])).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(contents(outsider, ['docs_content_a'])).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('does not use an implicit data owner as the authenticated caller for direct service reads', async () => {
    enablePolicy();
    await expect(
      new KnowledgeBaseSearchService(db, owner).getFileContents(['docs_content_a']),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(
      (
        await new KnowledgeBaseSearchService(
          db,
          owner,
          undefined,
          undefined,
          viewer,
        ).getFileContents(['docs_content_a'])
      )[0].content,
    ).toBe('library A text');
    const mixed = await new KnowledgeBaseSearchService(
      db,
      owner,
      undefined,
      undefined,
      viewer,
    ).getFileContents(['docs_content_a', 'docs_content_personal']);
    expect(mixed.map((row) => row.content)).toEqual(['library A text', '']);
  });

  it('rejects an anonymous chunk request', async () => {
    await expect(caller().getFileContents({ fileIds: ['docs_content_a'] })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('denies enterprise proxy preview/download without ever signing for anonymous or unauthorized users', async () => {
    enablePolicy();
    for (const identity of [undefined, outsider]) {
      boundary.identity = identity;
      for (const download of [false, true]) {
        const response = await proxy('file_content_a', download);
        expect(response.status).toBe(404);
        expect(response.headers.get('location')).toBeNull();
        expect(await response.text()).toBe('File not found');
      }
    }
    expect(boundary.sign).not.toHaveBeenCalled();
  });

  it('allows authorized enterprise preview and keeps non-enterprise anonymous links working when policies are enabled', async () => {
    enablePolicy();
    boundary.identity = viewer;
    expect((await proxy('file_content_a')).status).toBe(302);
    boundary.identity = undefined;
    expect((await proxy('file_content_personal')).status).toBe(302);
  });

  it('refuses operation-scoped tokens and API keys without file read scope at the file proxy', async () => {
    enablePolicy();
    boundary.identity = viewer;
    boundary.credential = { oidcAuth: { purpose: 'hetero-operation', sub: viewer } };
    expect((await proxy('file_content_a')).status).toBe(404);
    boundary.credential = { apiKeyScopes: ['agent:read'] };
    expect((await proxy('file_content_a')).status).toBe(404);
    boundary.credential = { apiKeyScopes: ['file:read'] };
    expect((await proxy('file_content_a')).status).not.toBe(404);
    boundary.credential = { apiKeyScopes: ['file:read'], workspaceId: 'ws-bound' };
    expect((await proxy('file_content_a')).status).toBe(404);
    boundary.credential = { oidcAuth: { purpose: 'hetero-operation', sub: viewer } };
    boundary.identity = undefined;
    expect((await proxy('file_content_personal')).status).toBe(302);
  });

  it('hides deleted enterprise items without granting access to unrelated private siblings', async () => {
    enablePolicy();
    boundary.identity = owner;
    expect((await proxy('file_content_deleted')).status).toBe(404);
    expect(boundary.sign).not.toHaveBeenCalled();
    await expect(contents(owner, ['docs_content_deleted'])).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(contents(owner, ['docs_content_deleted_backing'])).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const personal = await contents(viewer, ['docs_content_personal']);
    expect(personal[0].content).toBe('');
  });

  it('rechecks access on every read and fails closed when access resolution throws', async () => {
    enablePolicy();
    const currentCaller = caller(viewer);
    expect((await currentCaller.getFileContents({ fileIds: ['docs_content_a'] }))[0].content).toBe(
      'library A text',
    );
    vi.mocked(business.resolveEnterpriseKbAccess).mockResolvedValue({
      enterprise: true,
      access: null,
    });
    await expect(
      currentCaller.getFileContents({ fileIds: ['docs_content_a'] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    vi.mocked(business.resolveEnterpriseKbAccess).mockRejectedValue(
      new Error('resolution unavailable'),
    );
    boundary.identity = viewer;
    expect((await proxy('file_content_a')).status).toBe(404);
    await expect(contents(viewer, ['docs_content_a'])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(boundary.sign).not.toHaveBeenCalled();
  });

  it('fails closed on policy errors and on mismatched owner metadata', async () => {
    enablePolicy();
    boundary.identity = owner;
    vi.mocked(business.listEnterpriseKbIds).mockRejectedValue(new Error('policy unavailable'));
    expect((await proxy('file_content_a')).status).toBe(404);
    await expect(contents(owner, ['docs_content_a'])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    enablePolicy();
    vi.mocked(business.resolveEnterpriseKbAccess).mockResolvedValue({
      enterprise: true,
      access: { knowledgeBaseId: 'content-kb-a', ownerId: outsider, level: 'view' },
    });
    await expect(contents(viewer, ['docs_content_a'])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(boundary.sign).not.toHaveBeenCalled();
  });

  it('applies the existing workspace no-browse rule to full file and parsed-document reads', async () => {
    for (const id of ['file_content_workspace', 'docs_content_workspace']) {
      await expect(contents(viewer, [id], 'content-workspace')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    }
    expect(
      (await contents(owner, ['docs_content_workspace'], 'content-workspace'))[0].content,
    ).toBe('restricted text');
  });
});
