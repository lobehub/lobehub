import type { Node as FlowNode } from '@xyflow/react';

import type { GoalGraphView } from '../goalGraphViewModel';
import type { BatchRetroData, BatchRoundFrameData, BatchWavesData } from './BatchGroups';
import type { BatchLayout } from './batchLayout';
import { type BatchModel, roundRetro } from './batchModel';
import { batchStageId } from './batchScopeLayout';
import type { LayoutBox } from './layout';

/** Where a batch piece lands on the map: its parent and position. */
type PlaceInMap = (
  id: string,
  box: LayoutBox | undefined,
  owner?: string,
) => { parentId?: string; position: { x: number; y: number } };

interface BatchFlowNodesInput {
  batches: Map<string, { layout?: BatchLayout; model: BatchModel }>;
  byId: GoalGraphView['byId'];
  onEnter: (id: string) => void;
  onSelect: (id: string) => void;
  placeInMap: PlaceInMap;
  visibleIds: ReadonlySet<string>;
}

/**
 * The map nodes an open batch draws for its groups — the trials, each round's
 * frame, its retro and its waves. The plan and gate are real graph nodes and
 * are placed with the rest of the map.
 */
export const buildBatchFlowNodes = ({
  batches,
  byId,
  onEnter,
  onSelect,
  placeInMap,
  visibleIds,
}: BatchFlowNodesInput): FlowNode[] =>
  [...batches].flatMap(([batchId, { layout, model }]) => {
    if (!layout || !visibleIds.has(batchId)) return [];
    const [first] = model.rounds;
    // The roster waves a round owns, keeping each one's roster position.
    const rowsOf = (revision: number) =>
      model.waves.flatMap((cells, wave) =>
        model.waveRounds[wave] === revision ? [{ cells, wave }] : [],
      );
    return layout.groups.flatMap((group): FlowNode[] => {
      const round = model.rounds[group.revision - 1];
      const base = {
        draggable: false,
        id: group.id,
        ...placeInMap(group.id, group.box, batchId),
        selectable: false,
        width: group.box.width,
      };
      // A round's frame sits behind its nodes and the links between them.
      if (group.kind === 'round')
        return [
          {
            ...base,
            data: { revision: group.revision } satisfies BatchRoundFrameData,
            style: { height: group.box.height, width: group.box.width },
            type: 'goalBatchRound',
            zIndex: -1,
          },
        ];
      if (group.kind === 'retro') {
        const retro = roundRetro(model, group.revision);
        if (!retro) return [];
        return [
          {
            ...base,
            data: {
              onSelect,
              planSkill: model.planSkill,
              retro,
              templateId: round.templateId,
              verifier: model.verifier,
            } satisfies BatchRetroData,
            style: { width: group.box.width },
            type: 'goalBatchRetro',
          },
        ];
      }
      const data =
        group.kind === 'experimentProbe'
          ? {
              onEnter: () => onEnter(batchStageId(batchId, 0)),
              onSelect,
              probes: first.probes,
              started: first.probes.some((probe) => probe.state !== 'backlog'),
              views: byId,
            }
          : ({
              onEnter: () => onEnter(batchStageId(batchId, group.revision)),
              onSelect,
              probes: round.probes,
              retros: model.retros.length ? model.retros : undefined,
              revision: group.revision,
              rows: rowsOf(group.revision),
              started:
                group.revision === 1
                  ? !first.assayId || first.gate === 'passed' || first.gate === 'rejected'
                  : round.probes.some((probe) => probe.state !== 'backlog'),
              waveSize: model.waveSize,
            } satisfies BatchWavesData);
      return [
        {
          ...base,
          data,
          // Width is the layout's; height hugs the content, the layout only reserves it.
          style: { width: group.box.width },
          type: group.kind === 'experimentProbe' ? 'goalBatchExperimentProbe' : 'goalBatchWaves',
        },
      ];
    });
  });
