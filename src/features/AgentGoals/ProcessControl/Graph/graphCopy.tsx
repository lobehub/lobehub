'use client';

import '@xyflow/react/dist/style.css';

import type { GoalGraphEdge } from '@lobechat/types';
import { cssVar } from '@lobehub/ui';
import { DoorOpen } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import GateChecksHint from '../BatchGate/GateChecksHint';
import { type GoalNodeView } from '../goalGraphViewModel';
import { GATE_COLOR, SKILL_COLOR, SKILL_ICON } from '../shared';
import { CELL_VISUAL } from './BatchGroups';
import {
  type BatchGateState,
  type BatchModel,
  batchPlanTitleKey,
  type BatchRound,
  verdictChecks,
} from './batchModel';
import { type GraphNodeData, type StateChip } from './GraphNode';

export const useSubtitle = () => {
  const { t } = useTranslation('chat');
  return useCallback(
    (view: GoalNodeView): string => {
      const { node } = view;
      switch (node.kind) {
        case 'decision': {
          return node.status === 'waiting'
            ? t('goalProcess.tag.needsDecision')
            : (view.humanTouches[0]?.resolution ?? node.description?.slice(0, 32) ?? '');
        }
        case 'finding': {
          return view.producedBy?.title ?? '';
        }
        case 'problem': {
          return node.status === 'resolved'
            ? t('goalProcess.node.answered')
            : t('goalProcess.node.unanswered');
        }
        default: {
          return node.description?.slice(0, 34) ?? '';
        }
      }
    },
    [t],
  );
};

export const useEdgeLabel = () => {
  const { t } = useTranslation('chat');
  return useCallback(
    (kind: GoalGraphEdge['kind']): string | undefined => {
      switch (kind) {
        case 'answers': {
          return t('goalExperiment.answers');
        }
        case 'contains': {
          return undefined;
        }
        case 'derived_from': {
          return t('goalExperiment.continuedFrom');
        }
        case 'contradicts': {
          return t('goalProcess.edge.contradicts');
        }
        // `depends_on` is drawn blocker → blocked as a dashed edge — the dash
        // already reads as "blocked on"; any word on it invites a backwards
        // reading, so it carries no label.
        case 'investigates': {
          return t('goalProcess.edge.investigates');
        }
        case 'leads_to': {
          return t('goalProcess.edge.leadsTo');
        }
        case 'produces': {
          return t('goalProcess.edge.produces');
        }
        case 'supports': {
          return t('goalProcess.edge.supports');
        }
        // `decomposes` is the skeleton of the map; labelling every branch edge is noise.
        default: {
          return undefined;
        }
      }
    },
    [t],
  );
};

const GATE_CHIP: Record<BatchGateState, StateChip & { key: string }> = {
  checking: { ...CELL_VISUAL.running, key: 'checking', text: '' },
  human: { ...CELL_VISUAL.human, key: 'human', text: '' },
  locked: { ...CELL_VISUAL.backlog, key: 'locked', text: '' },
  passed: { ...CELL_VISUAL.done, key: 'passed', text: '' },
  rejected: { ...CELL_VISUAL.stale, key: 'rejected', text: '' },
};

/** What a batch member card says about its role: plan vN, or the release gate. */
export type BatchRole = { kind: 'assay' | 'template'; model: BatchModel; round: BatchRound };

export const useBatchCopy = () => {
  const { t } = useTranslation('chat');
  return useMemo(
    () => ({
      gate: (round: BatchRound, model: BatchModel): GraphNodeData['presentation'] => {
        const { key, ...chip } = GATE_CHIP[round.gate];
        // The latest verdict's checks with their results — a unit hold included —
        // and before any verdict, the plan.
        const latest = round.evaluations.at(-1);
        const judged = latest ? verdictChecks(latest) : [];
        // What the latest verdict found, at a glance: "3 ✓ · 1 ✗". Before any
        // verdict, how many checks it will run.
        const passed = judged.filter((check) => check.passed).length;
        const failed = judged.length - passed;
        // Green what passed, red what did not — the tally is the whole subtitle.
        const tally = latest ? (
          <span data-gate-tally>
            {passed > 0 && <span style={{ color: CELL_VISUAL.done.color }}>{`${passed} ✓`}</span>}
            {passed > 0 && failed > 0 && ' · '}
            {failed > 0 && <span style={{ color: cssVar.colorError }}>{`${failed} ✗`}</span>}
          </span>
        ) : (
          t('goalBatch.gate.checkCount', { count: model.gateChecks.length })
        );
        return {
          chip: { ...chip, text: t(`goalBatch.gate.status.${key}` as any) },
          // Which conditions decide the release, and how each stands, one hover away —
          // to the side, so it never covers the retro the gate sits under.
          hint: <GateChecksHint checks={latest ? judged : model.gateChecks} />,
          hintPlacement: 'rightTop',
          icon: DoorOpen,
          palette: GATE_COLOR,
          // Passed / sent back / waiting sits after the title, right-aligned.
          trailingChip: true,
          subtitle: tally,
          title:
            round.revision > 1
              ? t('goalBatch.gate.titleRound', { revision: round.revision })
              : t('goalBatch.gate.title'),
        };
      },
      template: (
        round: BatchRound,
        view: GoalNodeView,
        model: BatchModel,
      ): GraphNodeData['presentation'] => ({
        chip: null,
        // A plan kept as a skill reads as the skill every unit loads — its icon,
        // its colour, its identifier — not as a conclusion.
        ...(model.planSkill
          ? {
              icon: SKILL_ICON,
              palette: SKILL_COLOR,
              subtitle: `user-skills:${model.planSkill.name}`,
            }
          : { subtitle: view.node.description?.split('\n')[0] ?? '' }),
        title: t(batchPlanTitleKey(model, round), { revision: round.planVersion }),
      }),
    }),
    [t],
  );
};
