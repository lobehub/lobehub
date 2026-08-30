import type { ProjectionRef, ProjectionSource } from '../base';
import type { ProjectionKeyOf } from '../runtime';
import { defineProjectionKeySpace } from '../runtime';

export const BRIEF_NEWS_INDEX_PREFIX = 'brief.news:';

export const briefIndexKeySpace = defineProjectionKeySpace({
  patterns: [{ prefix: BRIEF_NEWS_INDEX_PREFIX }],
  staticKeys: [],
});

export type BriefNewsIndexKey = ProjectionKeyOf<typeof briefIndexKeySpace>;

export interface BriefNewsIndex {
  day: string;
  hasEarlier: boolean;
  key: BriefNewsIndexKey;
  observedAt: number;
  refs: ProjectionRef<'brief'>[];
  source: ProjectionSource;
}

export type BriefIndexMap = { [K in BriefNewsIndexKey]: BriefNewsIndex };

export const briefNewsIndexKey = (day: string): BriefNewsIndexKey =>
  `${BRIEF_NEWS_INDEX_PREFIX}${day}`;
