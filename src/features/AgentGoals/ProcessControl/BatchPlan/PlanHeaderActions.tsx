'use client';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@lobechat/const';
import { ActionIcon, Button, type DropdownItem, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { Check, ChevronDown, GitCompareArrows } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { GoalGraphView } from '../goalGraphViewModel';
import type { BatchModel, BatchRound } from '../Graph/batchModel';
import { openPlanCompareModal } from './PlanCompareModal';
import { usePlanVersions, usePlanVersionSelection } from './planVersion';

interface PlanHeaderActionsProps {
  graph: GoalGraphView;
  model: BatchModel;
  round: BatchRound;
}

/**
 * A plan's versions, kept out of the document: which one is shown, tucked
 * into the panel's corner, and a compare that opens the diff in a modal.
 */
const PlanHeaderActions = memo<PlanHeaderActionsProps>(({ graph, model, round }) => {
  const { t } = useTranslation('chat');
  const { selected, setSelected } = usePlanVersionSelection();
  const { versions } = usePlanVersions(graph, model);
  if (versions.length < 2) return null;

  const current = selected ?? round.planVersion;
  const latest = versions.at(-1)!.revision;
  const items: DropdownItem[] = [...versions].reverse().map((version) => ({
    extra: version.revision === current ? <Icon icon={Check} /> : undefined,
    key: String(version.revision),
    label:
      version.revision === latest
        ? t('goalBatch.planPanel.latest', { revision: version.revision })
        : `v${version.revision}`,
    onClick: () => setSelected(version.revision),
  }));

  return (
    <Flexbox horizontal align={'center'} gap={2}>
      <DropdownMenu items={items} placement={'bottomRight'}>
        <Button
          data-plan-version
          icon={ChevronDown}
          iconPosition={'end'}
          size={'small'}
          type={'text'}
        >
          {`v${current}`}
        </Button>
      </DropdownMenu>
      <ActionIcon
        data-plan-compare-open
        disabled={!versions.some((version) => version.revision < current)}
        icon={GitCompareArrows}
        size={DESKTOP_HEADER_ICON_SMALL_SIZE}
        title={t('goalBatch.planPanel.compare')}
        onClick={() => openPlanCompareModal({ target: current, versions })}
      />
    </Flexbox>
  );
});

PlanHeaderActions.displayName = 'GoalPlanHeaderActions';

export default PlanHeaderActions;
