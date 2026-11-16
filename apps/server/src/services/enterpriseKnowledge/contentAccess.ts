import type { EnterpriseKbAccess, EnterpriseKbAccessLevel } from '@lobechat/business-knowledge';
import {
  isEnterpriseKnowledgeEnabled,
  listEnterpriseKbIds,
  resolveEnterpriseKbAccess,
  resolveEnterpriseKbUserTree,
} from '@lobechat/business-knowledge';
import { hasApiKeyScope, isFullAccessApiKey } from '@lobechat/const/apiKeyScope';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import pMap from 'p-map';

import { documents, files, knowledgeBaseFiles, knowledgeBases } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

/**
 * Caller eligible to read managed content on surfaces that bypass the tRPC credential
 * middleware, such as the file proxy. Managed content is personal-scope: sessions,
 * ordinary OIDC and full-access or `file:read` API keys qualify; sandbox operation
 * tokens and any workspace-bound identity never do.
 */
export const resolveManagedContentReader = (identity: {
  apiKeyScopes?: string[] | null;
  oidcAuth?: object | null;
  userId?: string | null;
  workspaceId?: string | null;
}): string | undefined => {
  if (!identity.userId || identity.workspaceId) return undefined;
  const purpose = (identity.oidcAuth as { purpose?: unknown } | null | undefined)?.purpose;
  if (purpose === 'hetero-operation') return undefined;
  const scopes = identity.apiKeyScopes;
  if (scopes && !isFullAccessApiKey(scopes) && !hasApiKeyScope(scopes, 'file:read'))
    return undefined;
  return identity.userId;
};

interface ContentAccessContext {
  serverDB: LobeChatDatabase;
  /** Authenticated caller, distinct from the data owner's scope. */
  userId?: string | null;
  workspaceId?: string | null;
}

/** Load the authoritative directory only for libraries that have node policies. */
const resolveContentNodeLevels = async (
  db: LobeChatDatabase,
  userId: string,
  access: EnterpriseKbAccess,
): Promise<Map<string, EnterpriseKbAccessLevel | null>> => {
  const tree = await resolveEnterpriseKbUserTree(db, userId, access.knowledgeBaseId);
  if (
    !tree ||
    tree.knowledgeBaseId !== access.knowledgeBaseId ||
    tree.ownerId !== access.ownerId ||
    tree.owner !== false
  )
    throw new Error('Invalid enterprise node tree');

  const fileRows = await db
    .select({ id: files.id, parentId: files.parentId, isDeleted: files.isDeleted })
    .from(files)
    .innerJoin(knowledgeBaseFiles, eq(knowledgeBaseFiles.fileId, files.id))
    .where(
      and(
        eq(knowledgeBaseFiles.knowledgeBaseId, access.knowledgeBaseId),
        eq(files.userId, access.ownerId),
        isNull(files.workspaceId),
      ),
    );
  const documentRows = await db
    .select({
      id: documents.id,
      fileId: documents.fileId,
      fileType: documents.fileType,
      sourceType: documents.sourceType,
      parentId: documents.parentId,
      isDeleted: documents.isDeleted,
    })
    .from(documents)
    .where(
      and(
        eq(documents.userId, access.ownerId),
        isNull(documents.workspaceId),
        or(
          eq(documents.knowledgeBaseId, access.knowledgeBaseId),
          fileRows.length
            ? inArray(
                documents.fileId,
                fileRows.map((row) => row.id),
              )
            : undefined,
        ),
      ),
    );
  // A page authored in the library (markdown, HTML, ...) owns its backing file's location and
  // policy. Parsed mirrors (`sourceType: 'file'`) instead follow the file, and never become
  // independent permission nodes.
  const pageByFile = new Map(
    documentRows
      .filter((row) => row.fileId && row.sourceType !== 'file')
      .map((row) => [row.fileId, row.id]),
  );
  const nodes = new Map(
    [
      ...fileRows.map((row) => ({ ...row, isFolder: false, aliasOf: pageByFile.get(row.id) })),
      ...documentRows.map((row) => ({
        ...row,
        isFolder: row.fileType === 'custom/folder',
        aliasOf: row.fileId && pageByFile.get(row.fileId) !== row.id ? row.fileId : undefined,
      })),
    ].map((row) => [row.id, row]),
  );
  const policies = new Map(tree.nodes.map((row) => [row.nodeId, row.level]));
  const live = new Map<string, boolean>();
  const visiting = new Set<string>();
  const isLive = (id: string): boolean => {
    if (live.has(id)) return live.get(id)!;
    const row = nodes.get(id);
    if (!row || row.isDeleted || visiting.has(id)) return false;
    visiting.add(id);
    const valid = row.aliasOf
      ? isLive(row.aliasOf)
      : !row.parentId || (nodes.get(row.parentId)?.isFolder === true && isLive(row.parentId));
    visiting.delete(id);
    live.set(id, valid);
    return valid;
  };
  const levels = new Map<string, EnterpriseKbAccessLevel | null>();
  const level = (id: string): EnterpriseKbAccessLevel | null => {
    if (levels.has(id)) return levels.get(id)!;
    const row = nodes.get(id);
    const resolved =
      !row || !isLive(id)
        ? null
        : row.aliasOf
          ? level(row.aliasOf)
          : policies.has(id)
            ? policies.get(id)!
            : row.parentId
              ? level(row.parentId)
              : tree.libraryLevel;
    levels.set(id, resolved);
    return resolved;
  };
  for (const id of nodes.keys()) level(id);
  return levels;
};

/**
 * Resolve exact enterprise file/document ids before signing URLs or reading bodies.
 * Non-enterprise ids keep the existing model scope (and public-by-id proxy behavior).
 * A granted library never grants access to its owner's unrelated personal content.
 */
export const resolveEnterpriseContentScopes = async (
  ctx: ContentAccessContext,
  ids: string[],
): Promise<Map<string, string>> => {
  const scopes = new Map<string, string>();
  if (ctx.workspaceId || ids.length === 0 || !isEnterpriseKnowledgeEnabled()) return scopes;

  try {
    const documentIds = ids.filter((id) => id.startsWith('docs_'));
    const pages = documentIds.length
      ? await ctx.serverDB
          .select({
            id: documents.id,
            fileId: documents.fileId,
            knowledgeBaseId: documents.knowledgeBaseId,
            userId: documents.userId,
            isDeleted: documents.isDeleted,
          })
          .from(documents)
          .where(and(inArray(documents.id, documentIds), isNull(documents.workspaceId)))
      : [];
    const fileIds = [
      ...new Set([
        ...ids.filter((id) => !id.startsWith('docs_')),
        ...pages.flatMap((page) => (page.fileId ? [page.fileId] : [])),
      ]),
    ];
    const fileRows = fileIds.length
      ? await ctx.serverDB
          .select({
            id: files.id,
            userId: files.userId,
            isDeleted: files.isDeleted,
            knowledgeBaseId: knowledgeBaseFiles.knowledgeBaseId,
          })
          .from(files)
          .leftJoin(knowledgeBaseFiles, eq(knowledgeBaseFiles.fileId, files.id))
          .where(and(inArray(files.id, fileIds), isNull(files.workspaceId)))
      : [];
    const items = new Map<
      string,
      { userId: string; isDeleted: boolean | null; knowledgeBaseIds: Set<string> }
    >();
    for (const file of fileRows) {
      const item = items.get(file.id) ?? {
        userId: file.userId,
        isDeleted: file.isDeleted,
        knowledgeBaseIds: new Set<string>(),
      };
      if (file.knowledgeBaseId) item.knowledgeBaseIds.add(file.knowledgeBaseId);
      items.set(file.id, item);
    }
    for (const page of pages) {
      const backing = page.fileId ? items.get(page.fileId) : undefined;
      items.set(page.id, {
        userId: page.userId,
        isDeleted:
          page.isDeleted ||
          (!!page.fileId && (!backing || backing.isDeleted || backing.userId !== page.userId)),
        knowledgeBaseIds: new Set([
          ...(page.knowledgeBaseId ? [page.knowledgeBaseId] : []),
          ...(backing?.knowledgeBaseIds ?? []),
        ]),
      });
    }

    const candidates = [
      ...new Set([...items.values()].flatMap((item) => [...item.knowledgeBaseIds])),
    ];
    if (candidates.length === 0) return scopes;
    const enterpriseIds = await listEnterpriseKbIds(ctx.serverDB, candidates);
    if (enterpriseIds.length === 0) return scopes;
    const libraries = await ctx.serverDB
      .select({
        id: knowledgeBases.id,
        userId: knowledgeBases.userId,
        isDeleted: knowledgeBases.isDeleted,
      })
      .from(knowledgeBases)
      .where(and(inArray(knowledgeBases.id, enterpriseIds), isNull(knowledgeBases.workspaceId)));
    const enterpriseSet = new Set(enterpriseIds);
    const resolutions = new Map(
      await pMap(
        enterpriseIds,
        async (id) => {
          const resolution = ctx.userId
            ? await resolveEnterpriseKbAccess(ctx.serverDB, ctx.userId, id)
            : { enterprise: true as const, access: null };
          const library = libraries.find((row) => row.id === id);
          const access = resolution.enterprise ? resolution.access : null;
          const valid = !!(
            access &&
            library &&
            !library.isDeleted &&
            access.knowledgeBaseId === id &&
            access.ownerId === library.userId
          );
          const nodeLevels =
            valid && access && access.hasNodePolicies && access.level !== 'owner' && ctx.userId
              ? await resolveContentNodeLevels(ctx.serverDB, ctx.userId, access)
              : undefined;
          return [id, { access, valid, nodeLevels }] as const;
        },
        { concurrency: 10 },
      ),
    );

    for (const id of ids) {
      const item = items.get(id);
      if (!item) continue;
      const governedIds = [...item.knowledgeBaseIds].filter((kbId) => enterpriseSet.has(kbId));
      if (governedIds.length === 0) continue;
      const permitted =
        !item.isDeleted &&
        governedIds.some((kbId) => {
          const resolution = resolutions.get(kbId);
          return (
            resolution?.valid &&
            resolution.access &&
            resolution.access.ownerId === item.userId &&
            ['owner', 'edit', 'view'].includes(
              resolution.nodeLevels
                ? (resolution.nodeLevels.get(id) ?? '')
                : resolution.access.level,
            )
          );
        });
      if (!permitted) throw new TRPCError({ code: 'NOT_FOUND' });
      scopes.set(id, item.userId);
    }
    return scopes;
  } catch (error) {
    if (error instanceof TRPCError && error.code === 'NOT_FOUND') throw error;
    console.error('[enterpriseKnowledge] content access resolution failed', error);
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
};
