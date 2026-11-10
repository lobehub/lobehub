'use client';

import { createContext, memo, type PropsWithChildren, use, useMemo, useState } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { userSkillService } from '@/services/userSkill';

import type { GoalGraphView } from '../goalGraphViewModel';
import type { BatchModel, BatchRound } from '../Graph/batchModel';

/**
 * The plan version a reader picked in the panel's header, shared with its body.
 * Undefined until they pick one: the panel shows the round it opened on.
 */
const PlanVersionContext = createContext<{
  selected?: number;
  setSelected: (revision: number) => void;
}>({ setSelected: () => {} });

export const PlanVersionProvider = memo<PropsWithChildren>(({ children }) => {
  const [selected, setSelected] = useState<number>();
  const value = useMemo(() => ({ selected, setSelected }), [selected]);
  return <PlanVersionContext value={value}>{children}</PlanVersionContext>;
});

PlanVersionProvider.displayName = 'GoalPlanVersionProvider';

export const usePlanVersionSelection = () => use(PlanVersionContext);

export interface PlanVersion {
  /**
   * The plan's text, for a batch from before the plan became a skill. A skill
   * version's package is read on demand (`useSkillVersion`).
   */
  content?: string;
  revision: number;
}

/**
 * Every version of a batch's plan, oldest first. The plan is a skill in the
 * user's library, and every version it kept is listed — a plan the main Agent
 * rewrote inside a round included. A batch from before the plan became a
 * skill falls back to its plan nodes' text, one version per round.
 */
export const usePlanVersions = (graph: GoalGraphView, model: BatchModel) => {
  const planSkill = model.planSkill;
  // Keyed by the round count, so a revision the panel is open on loads its version.
  const { data: skill, isLoading } = useClientDataSWR(
    planSkill ? ['goal-plan-skill', planSkill.id, model.rounds.length] : null,
    () => userSkillService.get(planSkill!.id),
  );
  const kept = [...(skill?.versions ?? [])].sort((a, b) => a.version - b.version);
  const versions: PlanVersion[] = kept.length
    ? kept.map((version) => ({ revision: version.version }))
    : model.rounds
        .filter((item) => item.templateId)
        .map((item: BatchRound) => ({
          content: (item.templateId && graph.byId[item.templateId]?.node.description) || '',
          revision: item.planVersion,
        }));
  // The skill's current files, for a version that did not keep its own.
  return {
    files: skill?.files ?? [],
    isLoading: !!planSkill && isLoading,
    // Whose versions to read: only once the skill has listed them.
    skillId: kept.length ? planSkill?.id : undefined,
    versions,
  };
};
