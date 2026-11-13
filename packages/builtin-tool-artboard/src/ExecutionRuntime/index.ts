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
  type ArtboardToolService,
  type ArtboardToolSnapshot,
  type ArtboardToolState,
  type AskArtboardQuestionParams,
  type CreateArtboardParams,
  type ListArtboardCommentsParams,
  type ReadArtboardParams,
  type ReplyArtboardCommentParams,
  type ResolveArtboardCommentParams,
  type UpdateArtboardParams,
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
  const { source } = board;
  if (!source) return `${board.type} source unavailable`;
  return source.kind === 'canvas'
    ? `canvas ${source.canvasId} v${source.version}${source.path ? ` ${source.path}` : ''}`
    : `image ${source.fileId}`;
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
        `- ${e.id} ${e.from} → ${e.to} "${e.label}"${e.condition ? ` if: ${e.condition}` : ''}${e.isDefault ? ' (default)' : ''}`,
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

  async updateArtboard(params: UpdateArtboardParams): Promise<BuiltinServerRuntimeOutput> {
    const outcome = await this.service.update(params);
    if (!outcome.ok) return failure(outcome);

    const { artboard, changedIds } = outcome;
    return {
      content: `Updated artboard ${artboard.id} · revision ${artboard.revision} · ${describeArtboardContent(artboard.content)}. Changed: ${changedIds.join(', ') || 'nothing'}.`,
      state: toState(artboard, changedIds),
      success: true,
    };
  }

  async readArtboard(params: ReadArtboardParams): Promise<BuiltinServerRuntimeOutput> {
    const outcome = await this.service.read(params);
    if (!outcome.ok) return failure(outcome);

    const { artboard, canvases, staleBoardIds } = outcome;
    const stale = staleBoardIds.flatMap((boardId) => {
      const source = artboard.content.boards.find((b) => b.id === boardId)?.source;
      if (source?.kind !== 'canvas') return [];
      const latest = canvases[source.canvasId]?.latestVersion;
      return [
        `- ${boardId} shows Canvas ${source.canvasId} v${source.version}, latest is v${latest}`,
      ];
    });
    return {
      content: [
        formatBoard(artboard),
        ...(stale.length ? ['Boards behind their Canvas:', ...stale] : []),
      ].join('\n'),
      state: { ...toState(artboard, []), staleBoardIds },
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
