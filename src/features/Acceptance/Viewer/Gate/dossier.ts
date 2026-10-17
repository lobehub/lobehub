import type { GoalReleaseGateUnit } from '@lobechat/types';

/** The round a gate report shows: its newest. A bundle without rounds has none. */
export const latestRound = <R>(bundle?: { rounds?: R[] | null } | null): R | undefined =>
  (bundle?.rounds ?? []).at(-1);

/** A unit's deliverables; a dossier frozen by an older server may carry none. */
export const unitArtifacts = (unit: GoalReleaseGateUnit) => unit.artifacts ?? [];
