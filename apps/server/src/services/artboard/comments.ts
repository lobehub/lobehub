import { randomUUID } from 'node:crypto';

import type {
  ArtboardCommentAnchor,
  ArtboardCommentThreadView,
  ArtboardCommentView,
} from '@lobechat/types';

import type {
  ArtboardCommentModel,
  ArtboardCommentThread,
} from '@/database/models/artboard/comment';
import type {
  ArtboardStructure,
  ArtboardStructureModel,
} from '@/database/models/artboard/structure';

import { ArtboardServiceError, guardArtboard, requireRowId, requireText } from './errors';
import { sourceHashKey } from './opInputs';
import { isThreadUnread, toCommentThreadView, toCommentView } from './view';

export interface ArtboardCommentInput {
  anchor?: ArtboardCommentAnchor | null;
  boardId?: string | null;
  clientId: string;
  content: string;
  groupId?: string | null;
  pageId?: string | null;
}

export interface ArtboardQuestionInput {
  boardId?: string | null;
  content: string;
  groupId?: string | null;
  pageId?: string | null;
}

interface CommentDeps {
  agentId: string | null;
  comments: ArtboardCommentModel;
  fileHashes: (id: string) => Promise<ReadonlyMap<string, string>>;
  requireArtboard: (id: string) => Promise<unknown>;
  structure: ArtboardStructureModel;
}

type BoardSnapshot = ArtboardStructure & { hashes: ReadonlyMap<string, string> };

const inside = (value: number) => value >= 0 && value <= 1;

export class ArtboardCommentService {
  constructor(private deps: CommentDeps) {}

  private async structureOf(id: string): Promise<BoardSnapshot> {
    await this.deps.requireArtboard(id);
    const [structure, hashes] = await Promise.all([
      this.deps.structure.getStructure(id),
      this.deps.fileHashes(id),
    ]);
    if (!structure) throw new ArtboardServiceError('not_found', `No artboard with id "${id}".`);
    return { ...structure, hashes };
  }

  private view(structure: BoardSnapshot) {
    const shown = new Map(structure.boards.map((b) => [b.id, sourceHashKey(b, structure.hashes)]));
    return (thread: ArtboardCommentThread): ArtboardCommentThreadView => {
      const recorded = thread.root.metadata?.sourceHash;
      const { boardId } = thread.root;
      const stale = !!recorded && !!boardId && shown.get(boardId) !== recorded;
      return toCommentThreadView(thread, stale);
    };
  }

  private awaitingSubmit(structure: ArtboardStructure) {
    const open = new Set(structure.rounds.filter((r) => r.status === 'open').map((r) => r.id));
    const quiet = new Set(
      structure.boards.filter((b) => b.roundId && open.has(b.roundId)).map((b) => b.id),
    );
    return (thread: ArtboardCommentThread) =>
      !!thread.root.boardId && quiet.has(thread.root.boardId);
  }

  private async deliverable(id: string) {
    const structure = await this.structureOf(id);
    const held = this.awaitingSubmit(structure);
    const threads = await this.deps.comments.listThreads(id);
    return {
      structure,
      threads: threads.filter(
        (thread) => !held(thread) && (!thread.root.resolvedAt || isThreadUnread(thread)),
      ),
    };
  }

  async list(id: string): Promise<ArtboardCommentThreadView[]> {
    const structure = await this.structureOf(id);
    return (await this.deps.comments.listThreads(id)).map(this.view(structure));
  }

  async countUndelivered(id: string): Promise<number> {
    const { threads } = await this.deliverable(id);
    return threads.filter(isThreadUnread).length;
  }

  async takeUndelivered(id: string): Promise<ArtboardCommentThreadView[]> {
    const { structure, threads } = await this.deliverable(id);
    const pending = threads.flatMap(({ replies, root }) =>
      [root, ...replies].filter((comment) => !comment.deliveredAt).map((comment) => comment.id),
    );
    await this.deps.comments.markDelivered(pending, new Date());
    return threads.map(this.view(structure));
  }

  async open(
    id: string,
    input: ArtboardCommentInput,
    authorAgentId: string | null,
  ): Promise<ArtboardCommentThreadView> {
    requireText(input.content);
    if (input.boardId) requireRowId(input.boardId, 'board');
    const structure = await this.structureOf(id);
    const board = structure.boards.find((item) => item.id === input.boardId);
    const group = structure.groups.find((item) => item.id === input.groupId);
    const { anchor } = input;
    if (input.boardId && anchor?.type === 'canvas' && !(inside(anchor.x) && inside(anchor.y)))
      throw new ArtboardServiceError(
        'invalid',
        'A comment on a board is anchored by fractions (0–1) of the board’s width and height.',
      );

    const root = await guardArtboard(() =>
      this.deps.comments.create(id, {
        anchor: anchor ?? null,
        authorAgentId,
        boardId: input.boardId ?? null,
        clientId: input.clientId,
        content: input.content,
        groupId: input.groupId ?? null,
        metadata: {
          anchorSpace: board ? 'board' : group ? 'group' : 'page',
          ...(board && sourceHashKey(board, structure.hashes)
            ? { sourceHash: sourceHashKey(board, structure.hashes) }
            : {}),
        },
        pageId: input.pageId ?? board?.pageId ?? group?.pageId ?? structure.pages[0].id,
      }),
    );
    return toCommentThreadView({ replies: [], root }, false);
  }

  ask(id: string, input: ArtboardQuestionInput) {
    if (!this.deps.agentId)
      throw new ArtboardServiceError('invalid', 'Only an agent run can open a question thread.');
    return this.open(id, { ...input, clientId: randomUUID() }, this.deps.agentId);
  }

  async reply(
    commentId: string,
    input: { clientId?: string; content: string },
  ): Promise<ArtboardCommentView> {
    requireRowId(commentId, 'comment');
    requireText(input.content);
    const reply = await guardArtboard(() =>
      this.deps.comments.reply(commentId, {
        authorAgentId: input.clientId ? null : this.deps.agentId,
        clientId: input.clientId ?? randomUUID(),
        content: input.content,
      }),
    );
    return toCommentView(reply);
  }

  async settle(commentId: string, resolved: boolean) {
    requireRowId(commentId, 'comment');
    const root = await guardArtboard(() =>
      resolved ? this.deps.comments.resolve(commentId) : this.deps.comments.reopen(commentId),
    );
    return toCommentThreadView({ replies: [], root }, false);
  }
}
