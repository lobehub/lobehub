import { isDraftVerifyRun } from '@lobechat/const/verify';

import type { verifyService } from '@/services/verify';

import type { AcceptanceTabKey } from '../Header/AcceptanceTabs';

type Bundle = Awaited<ReturnType<typeof verifyService.getAcceptanceBundle>>;
export type FlowVersion = Bundle['flows'][number]['versions'][number];

export const getFlowNodeCount = (flows: Bundle['flows'] = []) =>
  flows.reduce(
    (sum, flow) => sum + (flow.versions.find((v) => v.nodes.length)?.nodes.length ?? 0),
    0,
  );

/**
 * Which face to show. Discussion leads the tab strip but is never the landing
 * tab: an acceptance opens on what has to be judged, not on a thread that is
 * usually still empty.
 */
export const resolveAcceptanceTab = (
  tab: AcceptanceTabKey | undefined,
  nodeCount: number,
  reviewingPlan = false,
  flowAvailable = true,
): AcceptanceTabKey => {
  const selected = tab ?? (reviewingPlan ? 'flow' : 'checks');
  return selected === 'flow' && (!flowAvailable || nodeCount === 0) ? 'checks' : selected;
};

/**
 * Round numbers come from the same acceptance ledger as the checklist. A draft
 * round has not executed, so it is the pending plan rather than a numbered
 * round; its snapshot follows the live graph and stands in for it.
 */
export const getFlowRoundViews = (flows: Bundle['flows'] = [], rounds: Bundle['rounds'] = []) => {
  const ledger = new Map(
    rounds.map(({ run }) => [run.id, { draft: isDraftVerifyRun(run), roundIndex: run.roundIndex }]),
  );
  const views: {
    id: string;
    roundIndex?: number;
    run?: FlowVersion['runs'][number];
    version: FlowVersion;
  }[] = [];
  for (const flow of flows) {
    const versions = flow.versions.filter((version) => version.nodes.length > 0);
    const hasDraft = versions.some((version) =>
      version.runs.some((run) => ledger.get(run.verifyRunId)?.draft),
    );
    for (const version of versions) {
      if (version === versions[0] && version.runs.length === 0 && !hasDraft) {
        views.push({ id: version.id, version });
      }
      for (const run of version.runs) {
        const round = ledger.get(run.verifyRunId);
        if (round?.roundIndex == null) continue;
        views.push({
          id: `${version.id}:${run.id}`,
          roundIndex: round.draft ? undefined : round.roundIndex,
          run,
          version,
        });
      }
    }
  }
  return views.sort((a, b) => (b.roundIndex ?? Infinity) - (a.roundIndex ?? Infinity));
};
