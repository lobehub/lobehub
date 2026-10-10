import type { AcceptanceSubjectType } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';
import type { AcceptanceBundle, AcceptanceBySubject } from '@/services/verify';

/**
 * The Acceptance aggregate of one acceptance id (`acceptanceBundleMap[id]`):
 * the live review surface read by the Acceptance viewer, the task acceptance
 * tab, the acceptance portal and the workbench embed.
 *
 * Persisted to IndexedDB, so a reload paints the last-seen bundle from the
 * local projection before the network confirms it — a 5s poll keeps the live
 * decision surface current afterwards.
 */
export const acceptanceBundleResource = defineReplica<string, AcceptanceBundle>({
  key: (acceptanceId) => acceptanceId,
  name: 'acceptanceBundle',
  storage: 'indexedDB',
  version: 1,
});

/** The subject (topic / task / document) an acceptance is attached to. */
export interface AcceptanceBySubjectParams {
  subjectId: string;
  subjectType: AcceptanceSubjectType;
}

/** One subject's entry key in `acceptanceBySubjectMap`. */
export const acceptanceBySubjectKey = ({ subjectId, subjectType }: AcceptanceBySubjectParams) =>
  `${subjectType}:${subjectId}`;

/**
 * The standing acceptance aggregate attached to a subject, keyed
 * `<subjectType>:<subjectId>` (`acceptanceBySubjectMap`). A subject without an
 * acceptance resolves to nothing — the sync hook keeps polling at a fast
 * interval to discover the aggregate a later verify run creates.
 */
export const acceptanceBySubjectResource = defineReplica<
  AcceptanceBySubjectParams,
  AcceptanceBySubject,
  AcceptanceBySubject
>({
  key: acceptanceBySubjectKey,
  name: 'acceptanceBySubject',
  storage: 'indexedDB',
  version: 1,
});
