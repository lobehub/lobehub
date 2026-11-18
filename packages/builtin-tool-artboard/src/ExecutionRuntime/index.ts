import type {
  ArtboardBoardView,
  ArtboardCommentThreadView,
  ArtboardCommentView,
  ArtboardContent,
  BuiltinServerRuntimeOutput,
  WorkRegistrationIntent,
} from '@lobechat/types';

import {
  ArtboardApiName,
  type ArtboardToolFailure,
  type ArtboardToolFile,
  type ArtboardToolService,
  type ArtboardToolSnapshot,
  type ArtboardToolState,
  type AskArtboardQuestionParams,
  type CreateArtboardParams,
  type ListArtboardCommentsParams,
  type ReadArtboardFileParams,
  type ReadArtboardParams,
  type ReplyArtboardCommentParams,
  type ResolveArtboardCommentParams,
  type UpdateArtboardParams,
  type WriteArtboardFilesParams,
} from '../types';

interface ArtboardRuntimeContext {
  onWorkRegistration?: (intent: WorkRegistrationIntent) => void;
}

export const describeArtboardContent = (content: ArtboardContent) =>
  `${content.groups.length} groups · ${content.boards.length} boards`;

const toState = (artboard: ArtboardToolSnapshot, changedIds: string[]): ArtboardToolState => ({
  artboardId: artboard.id,
  boardCount: artboard.content.boards.length,
  changedIds,
  groupCount: artboard.content.groups.length,
  phase: artboard.phase,
  revision: artboard.revision,
  title: artboard.title,
});

const HINTS: Record<string, string> = {
  conflict: `Call ${ArtboardApiName.readArtboard} for the latest revision, then apply your change to it.`,
  exists: `Use ${ArtboardApiName.readArtboard} and ${ArtboardApiName.updateArtboard} on that board instead.`,
  locked: 'Change other groups instead, or tell the user the journey is finalized.',
};

const failure = (outcome: ArtboardToolFailure): BuiltinServerRuntimeOutput => ({
  content: [outcome.message, HINTS[outcome.code]].filter(Boolean).join(' '),
  error: { message: outcome.message, type: outcome.code },
  success: false,
});

const formatSource = (board: ArtboardBoardView) => {
  if (board.type === 'decision') return 'decision';
  if (!board.source) return `${board.type} source unavailable`;
  // The board shows nothing until the file exists: tell the agent so it writes it.
  return `file ${board.source.path}${board.source.hash ? '' : ' (missing: write it)'}`;
};

const formatAnchor = (target: {
  boardId: string | null;
  groupId: string | null;
  pageId: string | null;
}) => {
  if (target.boardId) return `on board ${target.boardId}`;
  if (target.groupId) return `on group ${target.groupId}`;
  return target.pageId ? `on page ${target.pageId}` : 'on the artboard';
};

const formatBoard = (artboard: ArtboardToolSnapshot) => {
  const { boards, edges, groups, pages, questions, rounds } = artboard.content;
  return [
    `Artboard ${artboard.id} "${artboard.title}" · revision ${artboard.revision} · ${artboard.phase}`,
    'Pages:',
    ...pages.map((p) => `- ${p.id} "${p.name}"`),
    'Rounds:',
    ...rounds.map(
      (r) =>
        `- ${r.id} on ${r.pageId} "${r.title}" · ${r.status}${r.batchId ? ` · batch ${r.batchId}` : ''} · recommended ${r.recommendedBoardId ?? 'none'} · chosen ${r.chosenBoardId ?? 'none'}`,
    ),
    'Groups:',
    ...groups.map(
      (g) => `- ${g.id} on ${g.pageId} [${g.kind}] ${g.title}${g.desc ? ` — ${g.desc}` : ''}`,
    ),
    'Boards:',
    ...boards.map(
      (b) =>
        `- ${b.id} on ${b.pageId}${b.groupId ? ` in ${b.groupId}` : ''}${b.roundId ? ` round ${b.roundId}` : ''} "${b.title}" at (${b.rect.x}, ${b.rect.y}) ${b.rect.w}×${b.rect.h} ${formatSource(b)}${b.expected ? ` check: ${b.expected}` : ''}`,
    ),
    'Edges:',
    ...edges.map(
      (e) =>
        `- ${e.id} ${e.from} → ${e.to}${e.label ? ` "${e.label}"` : ''}${e.condition ? ` if: ${e.condition}` : ''}${e.isDefault ? ' (default)' : ''}`,
    ),
    'Your open questions:',
    ...questions.map((q) => `- ${q.id} ${formatAnchor(q)}: ${q.content}`),
  ].join('\n');
};

const formatAuthor = (comment: ArtboardCommentView) => (comment.authorAgentId ? 'agent' : 'user');

const formatThread = (thread: ArtboardCommentThreadView) =>
  [
    `- ${thread.id} ${formatAnchor(thread)} · ${formatAuthor(thread)}: ${thread.content}`,
    ...thread.replies.map((reply) => `  - ${reply.id} · ${formatAuthor(reply)}: ${reply.content}`),
  ].join('\n');

export class ArtboardExecutionRuntime {
  constructor(private service: ArtboardToolService) {}

  async createArtboard(
    params: CreateArtboardParams,
    context?: ArtboardRuntimeContext,
  ): Promise<BuiltinServerRuntimeOutput> {
    const outcome = await this.service.create(params);
    if (!outcome.ok) return failure(outcome);

    const { artboard, changedIds, task } = outcome;
    context?.onWorkRegistration?.({
      action: 'register',
      artboard: {
        artboardId: artboard.id,
        changeType: 'created',
        description: artboard.description,
        projectId: artboard.projectId,
        title: artboard.title,
        toolName: ArtboardApiName.createArtboard,
      },
      type: 'artboard',
    });

    const taskNote = task
      ? ` for task ${task.identifier}${task.createdTask ? ' (new task)' : ''}`
      : '';
    return {
      content: `Created artboard ${artboard.id} "${artboard.title}"${taskNote} · revision ${artboard.revision} · ${describeArtboardContent(artboard.content)}. The user sees it as a card under your reply; use ${ArtboardApiName.updateArtboard} with this id and revision for changes.`,
      state: toState(artboard, changedIds),
      success: true,
    };
  }

  async updateArtboard(
    params: UpdateArtboardParams,
    context?: ArtboardRuntimeContext,
  ): Promise<BuiltinServerRuntimeOutput> {
    const outcome = await this.service.update(params);
    if (!outcome.ok) return failure(outcome);

    const { artboard, changedIds } = outcome;

    // A real edit is a new Work version: it moves the card under this reply and
    // the version history to vN. A no-op edit (every op compared equal) stays
    // out of the history — nothing changed for the user to review.
    if (changedIds.length > 0) {
      context?.onWorkRegistration?.({
        action: 'register',
        artboard: {
          artboardId: artboard.id,
          changeType: 'updated',
          description: artboard.description,
          projectId: artboard.projectId,
          title: artboard.title,
          toolName: ArtboardApiName.updateArtboard,
        },
        type: 'artboard',
      });
    }

    return {
      content: `Updated artboard ${artboard.id} · revision ${artboard.revision} · ${describeArtboardContent(artboard.content)}. Changed: ${changedIds.join(', ') || 'nothing'}.`,
      state: toState(artboard, changedIds),
      success: true,
    };
  }

  async readArtboard(params: ReadArtboardParams): Promise<BuiltinServerRuntimeOutput> {
    const outcome = await this.service.read(params);
    if (!outcome.ok) return failure(outcome);

    const { artboard, files } = outcome;
    return {
      content: [
        formatBoard(artboard),
        'Files:',
        ...files.map((file) => `- ${file.path} ${file.size} B`),
      ].join('\n'),
      state: toState(artboard, []),
      success: true,
    };
  }

  async writeArtboardFiles(params: WriteArtboardFilesParams): Promise<BuiltinServerRuntimeOutput> {
    const outcome = await this.service.writeFiles(params);
    if (!outcome.ok) return failure(outcome);
    const { paths } = outcome;
    const count = `${paths.length} file${paths.length === 1 ? '' : 's'}`;
    return {
      content: paths.length
        ? `Saved ${count} on artboard ${params.id}: ${paths.join(', ')}.`
        : `Saved no new content on artboard ${params.id}.`,
      state: { artboardId: params.id, paths },
      success: true,
    };
  }

  async readArtboardFile(params: ReadArtboardFileParams): Promise<BuiltinServerRuntimeOutput> {
    const outcome = await this.service.readFile(params);
    if (!outcome.ok) return failure(outcome);
    return {
      content: outcome.content ?? `${outcome.path} is binary; it has no text to show.`,
      state: { path: outcome.path },
      success: true,
    };
  }

  async listArtboards(): Promise<BuiltinServerRuntimeOutput> {
    const outcome = await this.service.list();
    if (!outcome.ok) return failure(outcome);
    if (!outcome.artboards.length)
      return {
        content: 'No artboards in this project yet.',
        state: { artboards: [] },
        success: true,
      };

    return {
      content: outcome.artboards
        .map(
          (a) => `- ${a.id} "${a.title}" · task ${a.taskId} · ${a.phase} · revision ${a.revision}`,
        )
        .join('\n'),
      state: { artboards: outcome.artboards },
      success: true,
    };
  }

  async listArtboardComments(
    params: ListArtboardCommentsParams,
  ): Promise<BuiltinServerRuntimeOutput> {
    const outcome = await this.service.listComments(params);
    if (!outcome.ok) return failure(outcome);

    const { threads } = outcome;
    return {
      content: threads.length
        ? [
            `Unresolved comments on artboard ${params.id}:`,
            ...threads.map(formatThread),
            `Answer with ${ArtboardApiName.replyArtboardComment}; close a thread you have dealt with using ${ArtboardApiName.resolveArtboardComment}.`,
          ].join('\n')
        : `No unresolved comments on artboard ${params.id}.`,
      state: { artboardId: params.id, threadCount: threads.length },
      success: true,
    };
  }

  async replyArtboardComment(
    params: ReplyArtboardCommentParams,
  ): Promise<BuiltinServerRuntimeOutput> {
    const outcome = await this.service.replyComment(params);
    if (!outcome.ok) return failure(outcome);
    return {
      content: `Replied in thread ${params.commentId} as comment ${outcome.commentId}.`,
      state: { commentId: outcome.commentId },
      success: true,
    };
  }

  async resolveArtboardComment(
    params: ResolveArtboardCommentParams,
  ): Promise<BuiltinServerRuntimeOutput> {
    const outcome = await this.service.resolveComment(params);
    if (!outcome.ok) return failure(outcome);
    return {
      content: `Resolved thread ${outcome.commentId}.`,
      state: { commentId: outcome.commentId },
      success: true,
    };
  }

  async askArtboardQuestion(
    params: AskArtboardQuestionParams,
  ): Promise<BuiltinServerRuntimeOutput> {
    const outcome = await this.service.askQuestion(params);
    if (!outcome.ok) return failure(outcome);
    return {
      content: `Asked as thread ${outcome.commentId} on artboard ${params.id}. The user answers on the board; the board cannot finalize until you resolve this thread with ${ArtboardApiName.resolveArtboardComment}.`,
      state: { artboardId: params.id, commentId: outcome.commentId },
      success: true,
    };
  }
}
