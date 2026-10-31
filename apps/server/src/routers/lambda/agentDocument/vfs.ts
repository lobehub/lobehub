import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';

import {
  agentDocumentProcedure,
  agentDocumentProcedureWrite,
  handleAgentDocumentVfsError,
} from './procedures';

const readLocSchema = z
  .tuple([z.number().int().min(0), z.number().int().min(0)])
  .refine(([startLine, endLine]) => endLine >= startLine, {
    message: 'loc end line must be greater than or equal to start line',
  })
  .optional();

const writeCreateModeSchema = z.enum(['always-new', 'if-missing', 'must-exist']).optional();

const recursiveSchema = z.boolean().optional();

export const vfsRouter = router({
  /**
   * Tool-oriented: list documents for an agent
   */
  listDocuments: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        // Drop `sourceType: 'web'` docs (saved web-clips / articles). These grow
        // unbounded and dominate the payload, but only the working-sidebar "web"
        // tab renders them. Hot-path consumers (slash menu, skills) pass this so
        // the list stays small. Ignored for `currentTopic` scope.
        excludeWeb: z.boolean().optional().default(false),
        // Reveal the auto-created `.tool-results` archive. Off by default so
        // user-facing lists stay clean; the agent document-listing tool opts in.
        includeArchivedToolResults: z.boolean().optional().default(false),
        // Restrict the listing to the direct children of this folder so the model
        // can expand a folder collapsed in the progressive index.
        parentId: z.string().optional(),
        scope: z.enum(['agent', 'currentTopic']).optional().default('agent'),
        sourceType: z.enum(['all', 'file', 'web']).optional().default('all'),
        topicId: z.string().optional(),
        // Stamp `childCount` on entries with something nested under them (the
        // agent tool needs it to spot a workflow document holding its runs).
        withChildCount: z.boolean().optional().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { excludeWeb, includeArchivedToolResults, parentId } = input;
      const withChildCounts = async <T extends { documentId: string }>(docs: T[]) => {
        if (!input.withChildCount) return docs;
        const counts = await ctx.agentDocumentService.countChildren(input.agentId);
        return docs.map((doc) => ({ ...doc, childCount: counts.get(doc.documentId) ?? 0 }));
      };
      try {
        if (input.scope === 'currentTopic') {
          if (!input.topicId) {
            throw new Error('topicId is required to list current topic documents');
          }

          const docs = await ctx.agentDocumentService.listDocumentsForTopic(
            input.agentId,
            input.topicId,
            input.sourceType,
            { includeArchivedToolResults },
          );
          if (!parentId) return await withChildCounts(docs);

          // Topic listing joins through topic associations rather than the agent
          // folder tree, so the parent filter is applied in-memory here.
          const parent = await ctx.agentDocumentService.resolveParent(input.agentId, parentId);
          return await withChildCounts(docs.filter((d) => d.parentId === parent.documentId));
        }

        return await withChildCounts(
          await ctx.agentDocumentService.listDocuments(input.agentId, input.sourceType, {
            excludeWeb,
            includeArchivedToolResults,
            parentId,
          }),
        );
      } catch (error) {
        return handleAgentDocumentVfsError(error);
      }
    }),
  /**
   * Tool-oriented: list documents by VFS path
   */
  listDocumentsByPath: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        cursor: z.string().optional(),
        limit: z.number().int().positive().max(500).optional(),
        path: z.string(),
        topicId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.agentDocumentVfsService.list(
          input.path,
          {
            agentId: input.agentId,
            topicId: input.topicId,
          },
          {
            cursor: input.cursor,
            limit: input.limit,
          },
        );
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),
  /**
   * Tool-oriented: stat document by VFS path
   */
  statDocumentByPath: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        path: z.string(),
        topicId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.agentDocumentVfsService.stat(input.path, {
          agentId: input.agentId,
          topicId: input.topicId,
        });
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),
  /**
   * Tool-oriented: read document by VFS path
   */
  readDocumentByPath: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        loc: readLocSchema,
        path: z.string(),
        topicId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.agentDocumentVfsService.read(
          input.path,
          {
            agentId: input.agentId,
            topicId: input.topicId,
          },
          {
            loc: input.loc,
          },
        );
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),
  /**
   * Tool-oriented: write document by VFS path
   */
  writeDocumentByPath: agentDocumentProcedureWrite
    .input(
      z.object({
        agentId: z.string(),
        content: z.string(),
        createMode: writeCreateModeSchema,
        path: z.string(),
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.agentDocumentVfsService.write(
          input.path,
          input.content,
          {
            agentId: input.agentId,
            topicId: input.topicId,
          },
          { createMode: input.createMode },
        );
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),
  /**
   * Tool-oriented: create a VFS directory
   */
  mkdirDocumentByPath: agentDocumentProcedureWrite
    .input(
      z.object({
        agentId: z.string(),
        path: z.string(),
        recursive: recursiveSchema,
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.agentDocumentVfsService.mkdir(
          input.path,
          {
            agentId: input.agentId,
            topicId: input.topicId,
          },
          { recursive: input.recursive },
        );
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),
  /**
   * Tool-oriented: rename or move a VFS path
   */
  renameDocumentByPath: agentDocumentProcedureWrite
    .input(
      z.object({
        agentId: z.string(),
        force: z.boolean().optional(),
        fromPath: z.string(),
        toPath: z.string(),
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.agentDocumentVfsService.rename(
          input.fromPath,
          input.toPath,
          {
            agentId: input.agentId,
            topicId: input.topicId,
          },
          { overwrite: input.force },
        );
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),
  /**
   * Tool-oriented: copy a VFS path
   */
  copyDocumentByPath: agentDocumentProcedureWrite
    .input(
      z.object({
        agentId: z.string(),
        force: z.boolean().optional(),
        fromPath: z.string(),
        toPath: z.string(),
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.agentDocumentVfsService.copy(
          input.fromPath,
          input.toPath,
          {
            agentId: input.agentId,
            topicId: input.topicId,
          },
          { overwrite: input.force },
        );
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),
  /**
   * Tool-oriented: soft-delete a VFS path
   */
  deleteDocumentByPath: agentDocumentProcedureWrite
    .input(
      z.object({
        agentId: z.string(),
        force: z.boolean().optional(),
        path: z.string(),
        recursive: recursiveSchema,
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.agentDocumentVfsService.delete(
          input.path,
          {
            agentId: input.agentId,
            topicId: input.topicId,
          },
          { recursive: input.recursive },
        );
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),
  /**
   * Tool-oriented: list agent-scoped trash entries
   */
  listTrashDocumentsByPath: agentDocumentProcedure
    .input(
      z.object({
        agentId: z.string(),
        path: z.string().optional(),
        topicId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.agentDocumentVfsService.listTrash(
          {
            agentId: input.agentId,
            topicId: input.topicId,
          },
          input.path,
        );
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),
  /**
   * Tool-oriented: restore a trash entry
   */
  restoreDocumentFromTrashByPath: agentDocumentProcedureWrite
    .input(
      z.object({
        agentId: z.string(),
        path: z.string(),
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.agentDocumentVfsService.restoreFromTrashByPath(input.path, {
          agentId: input.agentId,
          topicId: input.topicId,
        });
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),
  /**
   * Tool-oriented: permanently remove a trash entry
   */
  deleteDocumentPermanentlyByPath: agentDocumentProcedureWrite
    .input(
      z.object({
        agentId: z.string(),
        force: z.boolean().optional(),
        path: z.string(),
        recursive: recursiveSchema,
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.agentDocumentVfsService.deletePermanentlyByPath(input.path, {
          agentId: input.agentId,
          topicId: input.topicId,
        });
      } catch (error) {
        handleAgentDocumentVfsError(error);
      }
    }),
});
