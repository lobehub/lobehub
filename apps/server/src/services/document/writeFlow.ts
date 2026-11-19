import { TRPCError } from '@trpc/server';
import pMap from 'p-map';

import { notifyDocumentMention } from '@/business/server/document-mention/notifyActivity';
import type { DocumentModel } from '@/database/models/document';
import { RbacModel } from '@/database/models/rbac';
import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import { DEFAULT_RESOURCE_ACCESS_LEVELS } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { canViewDocumentContent } from '@/server/services/documentAccess';
import { assertContentsNotInRestrictedKnowledgeBase } from '@/server/services/knowledgeBaseAccess';
import { updateDocumentThroughRoom } from '@/server/services/pageCollab/bodyWriter';
import { getResourceMeta } from '@/server/services/resourcePermission';
import { after } from '@/server/utils/scheduleAfterResponse';

import type { DocumentService } from '.';
import { resolveDocumentWrite } from './editorData';
import type { UpdateDocumentParams, UpdateDocumentResult } from './types';

/**
 * The create and update paths every document writer shares: the in-app tRPC
 * router and the public `/api/v1/documents` API. Keeping them here means slug
 * parents, parent visibility, Markdown → editor data, live-room writes and
 * mention notifications cannot drift between the two.
 */
export interface DocumentWriteContext {
  documentModel: DocumentModel;
  documentService: DocumentService;
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
}

/**
 * Creating a child or moving a row requires the parent to be visible in the
 * caller's workspace. Resource writes are role-gated at the procedure layer;
 * creator ownership and General Access do not further narrow ordinary Member
 * operations.
 */
export const assertCanCreateUnderParent = async (
  ctx: Pick<DocumentWriteContext, 'serverDB' | 'userId' | 'workspaceId'>,
  parentId: string | undefined,
) => {
  if (!ctx.workspaceId || !parentId) return;
  const meta = await getResourceMeta(ctx.serverDB, 'document', parentId);
  if (
    !meta ||
    meta.workspaceId !== ctx.workspaceId ||
    (meta.visibility === 'private' && meta.userId !== ctx.userId)
  ) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Parent document not found' });
  }
  await assertContentsNotInRestrictedKnowledgeBase(ctx, [parentId]);
};

/**
 * Ping members newly @-mentioned in the document body. Runs after the response
 * and re-checks each recipient against the document's General access, so a
 * chip for someone outside a private page never leaks its existence. The
 * business slot is a no-op outside Cloud.
 */
const notifyDocumentMentionsBestEffort = (
  ctx: { serverDB: LobeChatDatabase; userId: string; workspaceId: string },
  params: { documentId: string; mentionedUserIds: string[]; savedAt: Date },
) => {
  const recipientUserIds = [...new Set(params.mentionedUserIds)].filter(
    (userId) => userId !== ctx.userId,
  );
  if (recipientUserIds.length === 0) return;

  after(async () => {
    try {
      const [meta, permissionsByUserId] = await Promise.all([
        getResourceMeta(ctx.serverDB, 'document', params.documentId),
        RbacModel.getWorkspaceUsersPermissions({
          db: ctx.serverDB,
          requireMembership: true,
          userIds: recipientUserIds,
          workspaceId: ctx.workspaceId,
        }),
      ]);
      if (!meta) return;

      // One permission read and one notification write per recipient; a page can
      // mention many members, so bound the fan-out instead of opening them all at once.
      await pMap(
        recipientUserIds,
        async (recipientUserId) => {
          const grantedPermissions = permissionsByUserId.get(recipientUserId);
          if (!grantedPermissions) return;

          const canView = await canViewDocumentContent({
            db: ctx.serverDB,
            grantedPermissions,
            meta,
            resourceId: params.documentId,
            userId: recipientUserId,
            workspaceId: ctx.workspaceId,
          });
          if (!canView) return;

          await notifyDocumentMention({
            actorUserId: ctx.userId,
            documentId: params.documentId,
            recipientUserId,
            savedAt: params.savedAt,
            workspaceId: ctx.workspaceId,
          });
        },
        { concurrency: 5 },
      );
    } catch (error) {
      console.error('[document] Failed to send mention notification', error);
    }
  });
};

export interface CreateDocumentInput {
  content?: string;
  /** Serialized editor JSON; when absent the Markdown `content` is converted. */
  editorData?: string;
  fileType?: string;
  knowledgeBaseId?: string;
  metadata?: Record<string, any>;
  /** A folder id, or a folder slug. */
  parentId?: string;
  slug?: string;
  title: string;
  visibility?: 'private' | 'public';
}

export const createDocumentFromInput = async (
  ctx: DocumentWriteContext,
  input: CreateDocumentInput,
) => {
  let resolvedParentId = input.parentId;
  if (input.parentId) {
    const docBySlug = await ctx.documentModel.findBySlug(input.parentId);
    if (docBySlug) resolvedParentId = docBySlug.id;
  }

  await assertCanCreateUnderParent(ctx, resolvedParentId);

  const { content, editorData } = await resolveDocumentWrite({
    content: input.content,
    editorData: input.editorData ? JSON.parse(input.editorData) : undefined,
    fileType: input.fileType,
    title: input.title,
  });
  const document = await ctx.documentService.createDocument({
    ...input,
    content,
    editorData,
    parentId: resolvedParentId,
  });
  if (ctx.workspaceId && document.visibility !== 'private') {
    await new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId).setAccessLevel(
      'document',
      document.id,
      DEFAULT_RESOURCE_ACCESS_LEVELS.document,
      ctx.userId,
    );
  }
  return document;
};

export interface UpdateDocumentInput extends Omit<UpdateDocumentParams, 'editorData'> {
  /** Serialized editor JSON; when absent the Markdown `content` is converted. */
  editorData?: string;
  id: string;
}

export const updateDocumentFromInput = async (
  ctx: DocumentWriteContext,
  input: UpdateDocumentInput,
): Promise<UpdateDocumentResult> => {
  await assertContentsNotInRestrictedKnowledgeBase(ctx, [input.id]);

  const { id, editorData: editorDataString, ...params } = input;
  // A content-only write (the CLI) sends no editorData and often no fileType
  // or title; the stored fileType decides whether to build editorData from
  // Markdown, and the stored title names the heading to drop from it.
  // An HTML page never gets any (the service drops editorData sent for one).
  const needsStoredDocument =
    params.content !== undefined &&
    !editorDataString &&
    (params.fileType === undefined || params.title === undefined);
  const currentDocument =
    input.parentId !== undefined || needsStoredDocument
      ? await ctx.documentModel.findById(input.id)
      : undefined;

  // A move mutates both the source and destination trees as well as the
  // document. Only check when the parent really changes: several editor
  // paths include the current parentId in ordinary metadata/autosave
  // updates. `null` is an explicit detach and still leaves the source.
  if (input.parentId !== undefined) {
    const currentParentId = currentDocument?.parentId ?? null;
    const nextParentId = input.parentId ?? null;
    if (currentParentId !== nextParentId) {
      if (currentParentId) await assertCanCreateUnderParent(ctx, currentParentId);
      if (nextParentId) await assertCanCreateUnderParent(ctx, nextParentId);
    }
  }

  const { content, editorData } = await resolveDocumentWrite({
    content: params.content,
    editorData: editorDataString ? JSON.parse(editorDataString) : undefined,
    fileType: params.fileType ?? currentDocument?.fileType,
    title: params.title ?? currentDocument?.title ?? undefined,
  });
  // A page with a live room projects the room over its row, so the body
  // (from the CLI or a client that predates rooms) goes into the room.
  const result = await updateDocumentThroughRoom(
    ctx.serverDB,
    ctx.documentService,
    id,
    { ...params, content, editorData },
    { userId: ctx.userId, workspaceId: ctx.workspaceId ?? undefined },
  );

  if (ctx.workspaceId && result?.addedMentionUserIds && result.savedAt) {
    notifyDocumentMentionsBestEffort(
      { serverDB: ctx.serverDB, userId: ctx.userId, workspaceId: ctx.workspaceId },
      {
        documentId: id,
        mentionedUserIds: result.addedMentionUserIds,
        savedAt: result.savedAt,
      },
    );
  }

  return result;
};
