import type { ProjectionRef, ProjectionSource } from '../base';

export type BriefNewsIndexKey = `brief.news:${string}`;

export interface BriefNewsIndex {
  day: string;
  hasEarlier: boolean;
  key: BriefNewsIndexKey;
  observedAt: number;
  refs: ProjectionRef<'brief'>[];
  source: ProjectionSource;
}

export type BriefIndexMap = { [K in BriefNewsIndexKey]: BriefNewsIndex };

export const briefNewsIndexKey = (day: string): BriefNewsIndexKey => `brief.news:${day}`;
