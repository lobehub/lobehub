import type { ArtboardContent } from './artboard';

export type ArtboardFinalizeIssue =
  | { code: 'empty_journey' }
  | { code: 'entry_count'; entryBoardIds: string[] }
  | { boardId: string; code: 'missing_check' }
  | { code: 'multiple_journeys' }
  | { code: 'no_journey' }
  | { code: 'open_question'; commentId: string }
  | { code: 'open_round'; roundId: string }
  | { boardId: string; code: 'unreachable' };

export const artboardJourneyOf = (content: ArtboardContent) => {
  const groups = content.groups.filter((g) => g.kind === 'journey');
  if (groups.length !== 1) return { group: undefined, groups };
  const group = groups[0];
  const boards = content.boards.filter((b) => b.groupId === group.id);
  const boardIds = new Set(boards.map((b) => b.id));
  const edges = content.edges.filter((e) => boardIds.has(e.from) && boardIds.has(e.to));
  return { boards, edges, group, groups };
};

export const checkFinalizeReadiness = (content: ArtboardContent): ArtboardFinalizeIssue[] => {
  const issues: ArtboardFinalizeIssue[] = [
    ...content.rounds
      .filter((round) => round.status === 'open')
      .map((round) => ({ code: 'open_round' as const, roundId: round.id })),
    ...content.questions.map((question) => ({
      code: 'open_question' as const,
      commentId: question.id,
    })),
  ];
  const journey = artboardJourneyOf(content);

  if (!journey.group) {
    issues.unshift({ code: journey.groups.length ? 'multiple_journeys' : 'no_journey' });
    return issues;
  }
  const { boards, edges } = journey;
  if (!boards.length) {
    issues.unshift({ code: 'empty_journey' });
    return issues;
  }

  const journeyIssues: ArtboardFinalizeIssue[] = [];
  for (const board of boards)
    if (board.type !== 'decision' && !board.expected?.trim())
      journeyIssues.push({ boardId: board.id, code: 'missing_check' });

  const targets = new Set(edges.map((e) => e.to));
  const entries = boards.filter((b) => !targets.has(b.id));
  if (entries.length !== 1 || entries[0].type === 'decision') {
    journeyIssues.push({ code: 'entry_count', entryBoardIds: entries.map((b) => b.id) });
  } else {
    const reached = new Set([entries[0].id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const edge of edges)
        if (reached.has(edge.from) && !reached.has(edge.to)) {
          reached.add(edge.to);
          grew = true;
        }
    }
    for (const board of boards)
      if (!reached.has(board.id)) journeyIssues.push({ boardId: board.id, code: 'unreachable' });
  }

  return [...journeyIssues, ...issues];
};
