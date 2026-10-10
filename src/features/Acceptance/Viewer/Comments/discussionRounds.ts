import type { DiscussionEntry } from './discussionTimeline';

export interface DiscussionSection {
  entries: DiscussionEntry[];
  landedAt?: Date;
  messageCount: number;
  roundIndex: number | null;
  sentBack: boolean;
}

const saysSomething = (entry: DiscussionEntry) => {
  switch (entry.kind) {
    case 'message': {
      return !entry.comment.deletedAt;
    }
    case 'region': {
      return !entry.thread.root.deletedAt;
    }
    case 'round': {
      return Boolean(entry.proposal?.content.trim());
    }
    case 'roundReject':
    case 'checkReject': {
      return Boolean(entry.comment);
    }
    default: {
      return false;
    }
  }
};

// Comments carry no round of their own, so a round owns everything said
// between its landing and the next one.
export const groupDiscussionByRound = (entries: DiscussionEntry[]): DiscussionSection[] => {
  const sections: DiscussionSection[] = [];
  let current: DiscussionSection | undefined;

  for (const entry of entries) {
    if (entry.kind === 'round' || !current) {
      current = {
        entries: [],
        landedAt: entry.kind === 'round' ? entry.at : undefined,
        messageCount: 0,
        roundIndex: entry.kind === 'round' ? entry.roundIndex : null,
        sentBack: false,
      };
      sections.push(current);
    }
    current.entries.push(entry);
    if (saysSomething(entry)) current.messageCount += 1;
    if (entry.kind === 'roundReject') current.sentBack = true;
  }

  return sections.reverse();
};
