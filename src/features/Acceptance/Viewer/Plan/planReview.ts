import type { AcceptanceBundle } from '@/services/verify';

type Round = AcceptanceBundle['rounds'][number];

/** A prepared flow remains inspectable until execution starts. */
export const flowPlanPhase = (
  round: { run: Pick<Round['run'], 'flowSnapshots' | 'status'> } | undefined,
) => {
  if (!round?.run.flowSnapshots?.length || round.run.status !== 'planned') return undefined;
  return 'draft';
};
