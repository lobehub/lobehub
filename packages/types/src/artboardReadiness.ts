import type { ArtboardContent } from './artboard';

export type ArtboardFinalizeIssue =
  | { code: 'empty_journey' }
  | { code: 'entry_count'; entryFrameIds: string[] }
  | { code: 'missing_check'; frameId: string }
  | { code: 'multiple_journeys' }
  | { code: 'no_journey' }
  | { code: 'open_question'; noteId: string }
  | { code: 'unreachable'; frameId: string };

export const artboardJourneyOf = (content: ArtboardContent) => {
  const groups = content.groups.filter((g) => g.kind === 'journey');
  if (groups.length !== 1) return { group: undefined, groups };
  const group = groups[0];
  const frames = content.frames.filter((f) => f.groupId === group.id);
  const frameIds = new Set(frames.map((f) => f.id));
  const arrows = content.arrows.filter((a) => frameIds.has(a.from) && frameIds.has(a.to));
  return { arrows, frames, group, groups };
};

export const checkFinalizeReadiness = (content: ArtboardContent): ArtboardFinalizeIssue[] => {
  const issues: ArtboardFinalizeIssue[] = [];
  const journey = artboardJourneyOf(content);

  for (const note of content.notes)
    if (note.question?.status === 'open') issues.push({ code: 'open_question', noteId: note.id });

  if (!journey.group) {
    issues.unshift({ code: journey.groups.length ? 'multiple_journeys' : 'no_journey' });
    return issues;
  }
  const { arrows, frames } = journey;
  if (!frames.length) {
    issues.unshift({ code: 'empty_journey' });
    return issues;
  }

  const journeyIssues: ArtboardFinalizeIssue[] = [];
  for (const frame of frames)
    if (!frame.check?.expected.trim())
      journeyIssues.push({ code: 'missing_check', frameId: frame.id });

  const targets = new Set(arrows.map((a) => a.to));
  const entries = frames.filter((f) => !targets.has(f.id));
  if (entries.length !== 1) {
    journeyIssues.push({ code: 'entry_count', entryFrameIds: entries.map((f) => f.id) });
  } else {
    const reached = new Set([entries[0].id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const arrow of arrows)
        if (reached.has(arrow.from) && !reached.has(arrow.to)) {
          reached.add(arrow.to);
          grew = true;
        }
    }
    for (const frame of frames)
      if (!reached.has(frame.id)) journeyIssues.push({ code: 'unreachable', frameId: frame.id });
  }

  return [...journeyIssues, ...issues];
};
