import { DocumentApiName, PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import { TRPCError } from '@trpc/server';

import { DocumentModel } from '@/database/models/document';
import { appendMarkdownSnapshot } from '@/server/services/agentDocuments/headlessEditor';
import { DocumentService } from '@/server/services/document';
import { assertCanEditResource } from '@/server/services/resourcePermission';
import { BuiltinToolsExecutor } from '@/server/services/toolExecution/builtin';

import { assertQuickNoteCreatePermission } from './permission';
import type { QuickNoteToolCallPayload } from './schemas';
import {
  QUICK_NOTE_DIRECT_TOOL_CALLS,
  quickNotePageWriteArgumentsSchema,
  quickNoteToolCallPayloadSchema,
} from './schemas';
import type {
  QuickNoteExecutorContext,
  QuickNoteExecutorResult,
  QuickNoteProposalExecutor,
} from './types';
import { QuickNoteApplyError } from './types';

const isDirectToolCall = (identifier: string, apiName: string) =>
  (QUICK_NOTE_DIRECT_TOOL_CALLS as Record<string, readonly string[]>)[identifier]?.includes(
    apiName,
  ) ?? false;

const parseMarkdown = (payload: QuickNoteToolCallPayload) => {
  const args = quickNotePageWriteArgumentsSchema.safeParse(payload.arguments);
  if (!args.success) {
    throw new QuickNoteApplyError(
      'invalid_payload',
      `${payload.apiName} requires non-empty markdown`,
      {
        cause: args.error,
      },
    );
  }
  return args.data.markdown;
};

/**
 * Writes the Markdown into a new private Page through `lobe-page-agent.initPage`.
 *
 * The Page is created in the apply transaction, so a failed write leaves no empty Page behind.
 * Requires `DOCUMENT_CREATE`, like creating a Page from the Page list.
 */
const writeNewPage = async (
  ctx: QuickNoteExecutorContext,
  payload: QuickNoteToolCallPayload,
  markdown: string,
): Promise<QuickNoteExecutorResult> => {
  await assertQuickNoteCreatePermission(ctx, 'DOCUMENT_CREATE');

  const page = await new DocumentService(ctx.db, ctx.userId, ctx.workspaceId).createDocument({
    content: '',
    title: payload.title ?? 'Quick Note',
    visibility: 'private',
  });
  const result = await new BuiltinToolsExecutor(ctx.db, ctx.userId).execute(
    {
      apiName: DocumentApiName.initPage,
      arguments: JSON.stringify({ markdown }),
      id: `quick-note-proposal:${ctx.proposal.id}`,
      identifier: PageAgentIdentifier,
      type: 'builtin',
    },
    {
      documentId: page.id,
      serverDB: ctx.db,
      toolManifestMap: {},
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    },
  );
  if (!result.success) {
    throw new QuickNoteApplyError('tool_failed', result.content || 'Tool call failed', {
      cause: result.error,
    });
  }

  return { resultId: page.id, resultType: 'page' };
};

/**
 * Appends the Markdown after the last node of an existing Page the user may edit.
 *
 * Same guards as a user edit: the Document must be readable in this scope, the caller must hold
 * edit permission on it (workspace General access), and the write takes the collaborative edit
 * lock, so it is rejected while another member is editing. The write is a `llm_call` save, so
 * the previous version stays in the Page history and the user can restore it.
 */
const appendToExistingPage = async (
  ctx: QuickNoteExecutorContext,
  documentId: string,
  markdown: string,
): Promise<QuickNoteExecutorResult> => {
  const documentModel = new DocumentModel(ctx.db, ctx.userId, ctx.workspaceId);
  const target = await documentModel.findById(documentId);
  if (!target) throw new QuickNoteApplyError('not_found', 'Target Page not found');
  if (target.sourceType === 'quick-note') {
    // A note's own backing Document is edited through the note, not through a Proposal.
    throw new QuickNoteApplyError('unsupported_target', 'Cannot write into a Quick Note');
  }

  try {
    await assertCanEditResource({
      db: ctx.db,
      resourceId: documentId,
      resourceType: 'document',
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });
  } catch (error) {
    if (error instanceof TRPCError && (error.code === 'FORBIDDEN' || error.code === 'NOT_FOUND')) {
      throw new QuickNoteApplyError(
        error.code === 'FORBIDDEN' ? 'forbidden' : 'not_found',
        error.message,
        { cause: error },
      );
    }
    throw error;
  }

  const documentService = new DocumentService(ctx.db, ctx.userId, ctx.workspaceId);
  await documentService.runWithDocumentLock(documentId, async (lockOwnerId) => {
    // Re-read under the lock so the append lands on the latest saved body.
    const current = await documentModel.findById(documentId);
    if (!current) throw new QuickNoteApplyError('not_found', 'Target Page not found');

    let snapshot: Awaited<ReturnType<typeof appendMarkdownSnapshot>>;
    try {
      snapshot = await appendMarkdownSnapshot({
        editorData: current.editorData as Record<string, unknown> | null,
        fallbackContent: current.content ?? '',
        markdown,
      });
    } catch (error) {
      throw new QuickNoteApplyError(
        'invalid_payload',
        error instanceof Error ? error.message : 'Markdown could not be appended',
        { cause: error },
      );
    }

    await documentService.updateDocument(documentId, {
      content: snapshot.content,
      editorData: snapshot.editorData,
      ...(lockOwnerId ? { lockOwnerId } : {}),
      saveSource: 'llm_call',
    });
  });

  return { resultId: documentId, resultType: 'page' };
};

/**
 * `tool_call` Proposals: run one built-in page write with the stored arguments.
 *
 * Only tools listed in {@link QUICK_NOTE_DIRECT_TOOL_CALLS} run here. A tool that needs an Agent
 * conversation (to read context, or to ask for approval inside a run) is rejected; it belongs in
 * an Agent run with a `tool_approval` intervention.
 *
 * Applying is the approval: the user's click, or a score-4 judgement standing in for it, approves
 * exactly this write on exactly this Page. The write is deterministic (no Agent, no model call),
 * and the Proposal row lock held by the caller makes it run once per Proposal.
 *
 * - No `documentId` + `initPage`: write into a new private Page.
 * - `documentId` + `modifyNodes`: append to the end of that existing Page.
 */
export const toolCallExecutor: QuickNoteProposalExecutor<'tool_call'> = {
  execute: async (ctx, payload) => {
    if (!isDirectToolCall(payload.identifier, payload.apiName)) {
      throw new QuickNoteApplyError(
        'unsupported_tool',
        `Tool ${payload.identifier}.${payload.apiName} cannot run outside an Agent conversation`,
      );
    }

    const markdown = parseMarkdown(payload);

    if (payload.documentId) {
      if (payload.apiName !== DocumentApiName.modifyNodes) {
        throw new QuickNoteApplyError(
          'unsupported_target',
          'Writing into an existing Page appends with modifyNodes; initPage would replace it',
        );
      }
      return appendToExistingPage(ctx, payload.documentId, markdown);
    }

    if (payload.apiName !== DocumentApiName.initPage) {
      throw new QuickNoteApplyError(
        'unsupported_target',
        `${payload.apiName} needs the documentId of an existing Page`,
      );
    }
    return writeNewPage(ctx, payload, markdown);
  },
  kind: 'tool_call',
  schema: quickNoteToolCallPayloadSchema,
};
