import { ARTBOARD_BOARD_SIZE, type ArtboardPhase, type ArtboardRect } from '@lobechat/types';

import type {
  ArtboardBoardRow,
  ArtboardEdgeRow,
  ArtboardGroupRow,
  ArtboardPageRow,
  ArtboardRoundRow,
} from '@/database/models/artboard';
import type {
  ArtboardStructure,
  ArtboardStructureModel,
} from '@/database/models/artboard/structure';

import { failArtboard, toArtboardServiceError } from './errors';
import { EMPTY_GROUP_RECT, sameRect, toGroupRect, toPageRect, wrapBoards } from './layout';
import { boardTypeOf, resolveOpRefs, sourceColumns } from './opInputs';
import type { ResolvedArtboardOp } from './sources';

export interface ArtboardOpTarget {
  id: string;
  phase: ArtboardPhase;
  projectId: string | null;
}

type OpOf<T extends ResolvedArtboardOp['type']> = Extract<ResolvedArtboardOp, { type: T }>;

interface DraftBoard extends ArtboardBoardRow {
  stored: ArtboardRect;
}

const LAYOUT_KEYS = new Set(['h', 'w', 'x', 'y']);

class Draft {
  readonly changed: string[] = [];
  private refs = new Map<string, string>();
  private pages: ArtboardPageRow[];
  private rounds: ArtboardRoundRow[];
  private groups: ArtboardGroupRow[];
  private boards: DraftBoard[];
  private edges: ArtboardEdgeRow[];

  constructor(
    private model: ArtboardStructureModel,
    private artboard: ArtboardOpTarget,
    structure: ArtboardStructure,
  ) {
    this.pages = [...structure.pages];
    this.rounds = [...structure.rounds];
    this.groups = [...structure.groups];
    this.edges = [...structure.edges];
    const origins = new Map(structure.groups.map((group) => [group.id, group.rect]));
    this.boards = structure.boards.map((board) => ({
      ...board,
      rect: toPageRect(board.rect, board.groupId ? origins.get(board.groupId) : undefined),
      stored: board.rect,
    }));
  }

  private touch(id: string) {
    if (!this.changed.includes(id)) this.changed.push(id);
  }

  private page(id?: string) {
    if (!id) return this.pages[0];
    return this.pages.find((p) => p.id === id) ?? failArtboard('not_found', `No page ${id}`);
  }

  private round(id: string) {
    return this.rounds.find((r) => r.id === id) ?? failArtboard('not_found', `No round ${id}`);
  }

  private group(id: string) {
    return this.groups.find((g) => g.id === id) ?? failArtboard('not_found', `No group ${id}`);
  }

  private board(id: string) {
    return this.boards.find((b) => b.id === id) ?? failArtboard('not_found', `No board ${id}`);
  }

  private inJourney(groupId: string | null | undefined) {
    return !!groupId && this.groups.some((g) => g.id === groupId && g.kind === 'journey');
  }

  private assertJourneyOpen(what: string) {
    if (this.artboard.phase === 'finalized')
      failArtboard('locked', `The journey is finalized; ${what} can no longer change`);
  }

  private assertNoOtherJourney(exceptId?: string) {
    if (this.groups.some((g) => g.kind === 'journey' && g.id !== exceptId))
      failArtboard('invalid', 'The board already has a journey group');
  }

  private assertPlacement(
    pageId: string,
    group: ArtboardGroupRow | undefined,
    round: ArtboardRoundRow | undefined,
  ) {
    if (group && group.pageId !== pageId)
      failArtboard('invalid', 'A board is on the page of its group');
    if (round && round.pageId !== pageId)
      failArtboard('invalid', 'A board is on the page of its round');
    if (group?.kind === 'options' && !round)
      failArtboard(
        'invalid',
        'A board in an options group is an option of a round; add a round and pass its id as roundId',
      );
    if (round && group?.kind !== 'options')
      failArtboard('invalid', 'Only a board in an options group can be an option of a round');
  }

  private replaceRound(row: ArtboardRoundRow) {
    this.rounds = this.rounds.map((r) => (r.id === row.id ? row : r));
  }

  private async recommend(roundId: string, boardId: string | null) {
    this.replaceRound(await this.model.updateRound(roundId, { recommendedBoardId: boardId }));
    this.touch(roundId);
  }

  async apply(raw: ResolvedArtboardOp) {
    const ref = 'ref' in raw ? raw.ref : undefined;
    if (ref && this.refs.has(ref))
      failArtboard('invalid', `ref "${ref}" is used twice in this batch`);
    const createdId = await this.run(resolveOpRefs(raw, this.refs));
    if (ref && createdId) this.refs.set(ref, createdId);
  }

  private async run(op: ResolvedArtboardOp): Promise<string | void> {
    switch (op.type) {
      case 'addPage': {
        const sortOrder = Math.max(...this.pages.map((p) => p.sortOrder)) + 1;
        const row = await this.model.createPage(this.artboard.id, {
          name: op.page.name,
          sortOrder,
        });
        this.pages.push(row);
        this.touch(row.id);
        return row.id;
      }
      case 'updatePage': {
        this.page(op.id);
        const row = await this.model.updatePage(op.id, op.patch);
        this.pages = this.pages.map((p) => (p.id === row.id ? row : p));
        this.touch(row.id);
        return;
      }
      case 'removePage': {
        this.page(op.id);
        await this.model.deletePage(op.id);
        this.pages = this.pages.filter((p) => p.id !== op.id);
        this.touch(op.id);
        return;
      }
      case 'addRound': {
        const page = this.page(op.round.pageId);
        const row = await this.model.createRound(this.artboard.id, {
          metadata: op.round.batchId ? { batchId: op.round.batchId } : undefined,
          pageId: page.id,
          title: op.round.title,
        });
        this.rounds.push(row);
        this.touch(row.id);
        return row.id;
      }
      case 'updateRound': {
        this.round(op.id);
        this.replaceRound(await this.model.updateRound(op.id, op.patch));
        this.touch(op.id);
        return;
      }
      case 'addGroup': {
        return this.addGroup(op);
      }
      case 'updateGroup': {
        return this.updateGroup(op);
      }
      case 'removeGroup': {
        const group = this.group(op.id);
        if (this.boards.some((b) => b.groupId === group.id))
          failArtboard('invalid', `Group ${group.id} still has boards; remove or move them first`);
        if (group.kind === 'journey') this.assertJourneyOpen('the journey group');
        await this.model.deleteGroup(group.id);
        this.groups = this.groups.filter((g) => g.id !== group.id);
        this.touch(group.id);
        return;
      }
      case 'addBoard': {
        return this.addBoard(op);
      }
      case 'updateBoard': {
        return this.updateBoard(op);
      }
      case 'removeBoard': {
        return this.removeBoard(op);
      }
      case 'addEdge': {
        return this.addEdge(op);
      }
      case 'removeEdge': {
        const edge =
          this.edges.find((e) => e.id === op.id) ?? failArtboard('not_found', `No edge ${op.id}`);
        if (
          this.inJourney(this.board(edge.sourceBoardId).groupId) ||
          this.inJourney(this.board(edge.targetBoardId).groupId)
        )
          this.assertJourneyOpen('journey edges');
        await this.model.deleteEdge(edge.id);
        this.edges = this.edges.filter((e) => e.id !== edge.id);
        this.touch(edge.id);
        return;
      }
      case 'setCheck': {
        const board = this.board(op.boardId);
        if (!this.inJourney(board.groupId) || board.type === 'decision')
          failArtboard('invalid', 'Only journey boards that show a screen carry a check');
        this.assertJourneyOpen('acceptance checks');
        await this.model.updateBoard(board.id, { expected: op.expected });
        board.expected = op.expected;
        this.touch(board.id);
      }
    }
  }

  private async addGroup({ group }: OpOf<'addGroup'>) {
    if (group.kind === 'journey') this.assertNoOtherJourney();
    const page = this.page(group.pageId);
    const row = await this.model.createGroup(this.artboard.id, {
      description: group.desc ?? null,
      kind: group.kind,
      pageId: page.id,
      rect: EMPTY_GROUP_RECT,
      title: group.title,
    });
    this.groups.push(row);
    this.touch(row.id);
    return row.id;
  }

  private async updateGroup({ id, patch }: OpOf<'updateGroup'>) {
    const group = this.group(id);
    const members = this.boards.filter((b) => b.groupId === group.id);
    const kindChanges = patch.kind !== undefined && patch.kind !== group.kind;
    if (kindChanges) {
      if (patch.kind === 'journey') this.assertNoOtherJourney(group.id);
      if (group.kind === 'journey' || patch.kind === 'journey')
        this.assertJourneyOpen('the journey group');
      if (patch.kind === 'options' && members.some((b) => !b.roundId))
        failArtboard('invalid', 'Every board in an options group is an option of a round');
      if (group.kind === 'options' && members.some((b) => b.roundId))
        failArtboard('invalid', 'Take the boards out of their round before changing this group');
    }

    const row = await this.model.updateGroup(group.id, {
      ...(patch.desc === undefined ? {} : { description: patch.desc }),
      ...(patch.kind === undefined ? {} : { kind: patch.kind }),
      ...(patch.title === undefined ? {} : { title: patch.title }),
    });
    this.groups = this.groups.map((g) => (g.id === row.id ? { ...row, rect: g.rect } : g));
    this.touch(group.id);

    if (kindChanges && group.kind === 'journey')
      for (const board of members.filter((b) => b.expected !== null)) {
        await this.model.updateBoard(board.id, { expected: null });
        board.expected = null;
      }
  }

  private async addBoard({ board }: OpOf<'addBoard'>) {
    const group = board.groupId ? this.group(board.groupId) : undefined;
    const round = board.roundId ? this.round(board.roundId) : undefined;
    const page = this.page(board.pageId ?? group?.pageId ?? round?.pageId);
    this.assertPlacement(page.id, group, round);
    if (round && round.status !== 'open')
      failArtboard('locked', `Round ${round.id} is submitted; its options can no longer change`);
    const type = boardTypeOf(board.type, board.source);
    const journey = this.inJourney(group?.id);
    if (journey) this.assertJourneyOpen('journey boards');
    if (board.expected !== undefined && (!journey || type === 'decision'))
      failArtboard('invalid', 'Only journey boards that show a screen carry a check');
    if (board.recommended && !round)
      failArtboard('invalid', 'Only an option of a round can be recommended');

    const rect = {
      h: board.h ?? ARTBOARD_BOARD_SIZE.height,
      w: board.w ?? ARTBOARD_BOARD_SIZE.width,
      x: board.x,
      y: board.y,
    };
    const row = await this.model.createBoard(this.artboard.id, {
      ...sourceColumns(board.source),
      expected: board.expected ?? null,
      groupId: group?.id ?? null,
      pageId: page.id,
      projectId: this.artboard.projectId,
      rect,
      roundId: round?.id ?? null,
      title: board.title,
      type,
    });
    this.boards.push({ ...row, stored: rect });
    this.touch(row.id);
    if (board.recommended && round) await this.recommend(round.id, row.id);
    return row.id;
  }

  private async updateBoard({ id, patch }: OpOf<'updateBoard'>) {
    const board = this.board(id);
    const group =
      patch.groupId === undefined
        ? board.groupId
          ? this.group(board.groupId)
          : undefined
        : patch.groupId
          ? this.group(patch.groupId)
          : undefined;
    let round =
      patch.roundId === undefined
        ? board.roundId
          ? this.round(board.roundId)
          : undefined
        : patch.roundId
          ? this.round(patch.roundId)
          : undefined;
    const previousRound = board.roundId ? this.round(board.roundId) : undefined;
    const roundChanges = (round?.id ?? null) !== board.roundId;
    const journey = this.inJourney(group?.id);
    const layoutOnly = Object.keys(patch).every((key) => LAYOUT_KEYS.has(key));
    if ((journey || this.inJourney(board.groupId)) && !layoutOnly)
      this.assertJourneyOpen('journey boards');

    if (patch.recommended === false && previousRound?.recommendedBoardId === board.id)
      await this.recommend(previousRound.id, null);
    if (roundChanges) {
      const left = previousRound && this.round(previousRound.id);
      if (left && left.status !== 'open')
        failArtboard('locked', `Round ${left.id} is submitted; its options can no longer change`);
      if (left && (left.recommendedBoardId === board.id || left.chosenBoardId === board.id))
        failArtboard(
          'invalid',
          `Board ${board.id} is the recommendation or the pick of round ${left.id}; remove the board instead of moving it`,
        );
      if (round && round.status !== 'open')
        failArtboard('locked', `Round ${round.id} is submitted; its options can no longer change`);
    }
    if (roundChanges || (group?.id ?? null) !== board.groupId)
      this.assertPlacement(board.pageId, group, round);

    const type =
      patch.source === undefined
        ? board.type
        : boardTypeOf(board.type === 'decision' ? 'decision' : undefined, patch.source);
    const carriesCheck = journey && type !== 'decision';
    if (patch.expected !== undefined && !carriesCheck)
      failArtboard('invalid', 'Only journey boards that show a screen carry a check');
    const expected = carriesCheck ? (patch.expected ?? board.expected) : null;

    const values = {
      ...(patch.source === undefined ? {} : { ...sourceColumns(patch.source), type }),
      ...(patch.title === undefined ? {} : { title: patch.title }),
      ...(expected === board.expected ? {} : { expected }),
      ...((group?.id ?? null) === board.groupId ? {} : { groupId: group?.id ?? null }),
      ...(roundChanges ? { roundId: round?.id ?? null } : {}),
    };
    const row = Object.keys(values).length ? await this.model.updateBoard(board.id, values) : board;
    Object.assign(board, row, {
      rect: {
        h: patch.h ?? board.rect.h,
        w: patch.w ?? board.rect.w,
        x: patch.x ?? board.rect.x,
        y: patch.y ?? board.rect.y,
      },
      stored: board.stored,
    });
    this.touch(board.id);

    if (patch.recommended) {
      round = board.roundId ? this.round(board.roundId) : undefined;
      if (!round) return failArtboard('invalid', 'Only an option of a round can be recommended');
      await this.recommend(round.id, board.id);
    }
  }

  private async removeBoard({ id }: OpOf<'removeBoard'>) {
    const board = this.board(id);
    if (this.inJourney(board.groupId)) this.assertJourneyOpen('journey boards');
    const round = board.roundId ? this.round(board.roundId) : undefined;
    if (round?.status === 'submitted' && round.chosenBoardId === board.id)
      failArtboard('locked', `Board ${board.id} is the submitted pick of round ${round.id}`);

    await this.model.deleteBoard(board.id);
    this.boards = this.boards.filter((b) => b.id !== board.id);
    this.touch(board.id);
    for (const edge of this.edges)
      if (edge.sourceBoardId === board.id || edge.targetBoardId === board.id) this.touch(edge.id);
    this.edges = this.edges.filter(
      (e) => e.sourceBoardId !== board.id && e.targetBoardId !== board.id,
    );
    this.rounds = this.rounds.map((r) => ({
      ...r,
      chosenBoardId: r.chosenBoardId === board.id ? null : r.chosenBoardId,
      recommendedBoardId: r.recommendedBoardId === board.id ? null : r.recommendedBoardId,
    }));
  }

  private async addEdge({ edge }: OpOf<'addEdge'>) {
    const from = this.board(edge.from);
    const to = this.board(edge.to);
    if (from.id === to.id) failArtboard('invalid', 'An edge needs two different boards');
    if (from.pageId !== to.pageId)
      failArtboard('invalid', 'An edge connects two boards on the same page');
    if (this.inJourney(from.groupId) || this.inJourney(to.groupId))
      this.assertJourneyOpen('journey edges');
    const siblings = this.edges.filter((e) => e.sourceBoardId === from.id);
    if (edge.isDefault && siblings.some((e) => e.isDefault))
      failArtboard('invalid', `Board ${from.id} already has a default edge`);

    const row = await this.model.createEdge(this.artboard.id, {
      condition: edge.condition ?? null,
      isDefault: edge.isDefault ?? false,
      label: edge.label,
      sortOrder: siblings.length,
      sourceBoardId: from.id,
      targetBoardId: to.id,
    });
    this.edges.push(row);
    this.touch(row.id);
    return row.id;
  }

  async flushLayout() {
    for (const group of this.groups) {
      const rect = wrapBoards(this.boards.filter((b) => b.groupId === group.id).map((b) => b.rect));
      if (sameRect(group.rect, rect)) continue;
      await this.model.updateGroup(group.id, { rect });
      group.rect = rect;
    }
    const origins = new Map(this.groups.map((group) => [group.id, group.rect]));
    for (const board of this.boards) {
      const rect = toGroupRect(board.rect, board.groupId ? origins.get(board.groupId) : undefined);
      if (sameRect(board.stored, rect)) continue;
      await this.model.updateBoard(board.id, { rect });
      board.stored = rect;
    }
  }
}

export const applyArtboardOps = async (
  model: ArtboardStructureModel,
  artboard: ArtboardOpTarget,
  ops: ResolvedArtboardOp[],
): Promise<string[]> => {
  const structure = await model.getStructure(artboard.id);
  if (!structure) return failArtboard('not_found', `Artboard "${artboard.id}" was not found.`);

  const draft = new Draft(model, artboard, structure);
  for (const [index, op] of ops.entries()) {
    try {
      await draft.apply(op);
    } catch (error) {
      throw toArtboardServiceError(error, index);
    }
  }
  await draft.flushLayout();
  return draft.changed;
};
