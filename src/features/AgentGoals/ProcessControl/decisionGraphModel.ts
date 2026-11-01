import { GOAL_CLARIFICATION_OPTION } from '@lobechat/const/goal';
import type { GoalDecisionOption } from '@lobechat/types';

import type { DecisionActor, DecisionRow } from './decisionList';

/**
 * The shape of one decision drawn as a graph: what raised it, the options it
 * offered, and — once settled — where the answer went. Pure data; labels and
 * layout belong to the view.
 */

/** What picking an option does to the work that raised the question. */
export type DecisionEffect = 'fail' | 'retire' | 'retry';

export interface DecisionGraphOption {
  description?: string;
  effect?: DecisionEffect;
  id: string;
  label: string;
  recommended: boolean;
  /** `chosen` is the picked path, `dim` an option passed over, `open` one still on the table. */
  state: 'chosen' | 'dim' | 'open';
}

export interface DecisionGraphResult {
  actor: Exclude<DecisionActor, 'pending'>;
  effect?: DecisionEffect;
  /** Where the line into the result comes from: the picked option, or the question when the answer was written out. */
  from: 'option' | 'root';
  note?: string;
}

export interface DecisionGraphModel {
  options: DecisionGraphOption[];
  result?: DecisionGraphResult;
}

const COORDINATOR_EFFECTS = new Set<string>(['fail', 'retire', 'retry']);

export const effectOfOption = (
  option: Pick<GoalDecisionOption, 'effect' | 'id'>,
): DecisionEffect | undefined =>
  option.effect ?? (COORDINATOR_EFFECTS.has(option.id) ? (option.id as DecisionEffect) : undefined);

/**
 * `labels` are the options as the reader should see them (already localized,
 * same order as the stored ones); stored ids and effects decide everything else.
 */
export const buildDecisionGraph = (
  row: DecisionRow,
  labels: { description?: string; id: string; label: string }[],
): DecisionGraphModel => {
  const { decision } = row;
  const stored = new Map((decision.options ?? []).map((option) => [option.id, option]));
  const settled = row.actor !== 'pending';
  const chosenId = settled ? decision.resolvedOptionId : undefined;
  const hasChosen = !!chosenId && labels.some((option) => option.id === chosenId);

  const options = labels.map((option): DecisionGraphOption => {
    const effect = stored.has(option.id) ? effectOfOption(stored.get(option.id)!) : undefined;
    return {
      ...(option.description ? { description: option.description } : {}),
      ...(effect ? { effect } : {}),
      id: option.id,
      label: option.label,
      recommended: option.id === decision.recommendedOptionId,
      state: !hasChosen ? 'open' : option.id === chosenId ? 'chosen' : 'dim',
    };
  });

  if (!settled || row.actor === 'pending') return { options };

  const chosen = options.find((option) => option.state === 'chosen');
  const effect = chosen?.effect;
  // The free-text option carries no wording of its own, so the words are the
  // answer itself: `buildDecisionRows` keeps them on `choice` instead of the
  // `note` written next to a picked option. The graph has to show them either
  // way, or expanding the decision would hide what the person actually said.
  const answered = decision.resolvedOptionId === GOAL_CLARIFICATION_OPTION.answer;
  const written = row.note ?? (answered || !chosen ? row.choice : undefined);
  return {
    options,
    result: {
      actor: row.actor,
      ...(effect ? { effect } : {}),
      from: chosen ? 'option' : 'root',
      ...(written ? { note: written } : {}),
    },
  };
};

export interface Point {
  x: number;
  y: number;
}

/** A horizontal S-curve between two node edges, the way the exploration map joins its nodes. */
export const connectorPath = (from: Point, to: Point): string => {
  const reach = Math.max(24, (to.x - from.x) / 2);
  return `M ${from.x} ${from.y} C ${from.x + reach} ${from.y}, ${to.x - reach} ${to.y}, ${to.x} ${to.y}`;
};
