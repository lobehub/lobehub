import {
  isEnterpriseKnowledgeEnabled,
  listEnterpriseKbIds,
  resolveEnterpriseKbAccess,
} from '@lobechat/business-knowledge';
import { hasApiKeyScope, isFullAccessApiKey } from '@lobechat/const/apiKeyScope';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull } from 'drizzle-orm';
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
        async (id) =>
          [
            id,
            ctx.userId
              ? await resolveEnterpriseKbAccess(ctx.serverDB, ctx.userId, id)
              : { enterprise: true as const, access: null },
          ] as const,
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
          const library = libraries.find((row) => row.id === kbId);
          return (
            resolution?.enterprise &&
            resolution.access &&
            library &&
            !library.isDeleted &&
            resolution.access.knowledgeBaseId === kbId &&
            resolution.access.ownerId === library.userId &&
            library.userId === item.userId &&
            ['owner', 'edit', 'view'].includes(resolution.access.level)
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
