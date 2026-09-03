'use client';

import { Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRight } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AcceptanceBundle } from '@/services/verify';

import InteractionCostPanel from '../Report/InteractionCost';
import { formatSeconds } from '../Report/interactionCostModel';
import { buildCheckLabels, selectPricedRound } from './interactionCost';

/**
 * The latest priced round's interaction cost, on the acceptance page itself.
 *
 * The panel used to live only in the round report, which opens from owner-scoped
 * round history — so the one audience the number exists for, a reviewer weighing
 * whether a flow is worth accepting, could never see it. The cost already ships
 * in the shared bundle (only `origin` is stripped for visitors), so surfacing it
 * here needs no extra read and no extra permission.
 *
 * Deliberately a plain disclosure, not a card: the checks are what a reviewer
 * acts on, and a bordered block here would compete with them for the same
 * attention. Collapsed it is one muted line carrying the only number worth
 * seeing at a glance; the breakdown is one click away.
 */

const styles = createStaticStyles(({ css }) => ({
  body: css`
    padding-block-end: 4px;
    padding-inline-start: 24px;
  `,
  chevron: css`
    transition: transform 0.15s ease;

    &[data-open='true'] {
      transform: rotate(90deg);
    }
  `,
  total: css`
    margin-inline-start: 6px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface AcceptanceInteractionCostProps {
  data: AcceptanceBundle;
}

const AcceptanceInteractionCost = memo<AcceptanceInteractionCostProps>(({ data }) => {
  const { t } = useTranslation('verify');
  const [open, setOpen] = useState(false);

  const priced = useMemo(() => selectPricedRound(data.rounds), [data.rounds]);
  const checkLabels = useMemo(() => buildCheckLabels(data.checks), [data.checks]);

  if (!priced) return null;

  return (
    <>
      <Button
        icon={<Icon className={styles.chevron} data-open={open} icon={ChevronRight} />}
        size={'small'}
        style={{ alignSelf: 'flex-start' }}
        type={'text'}
        onClick={() => setOpen((prev) => !prev)}
      >
        {t('report.interaction.title')}
        <span className={styles.total}>{formatSeconds(priced.cost.totalSeconds)}</span>
      </Button>
      {open && (
        <div className={styles.body}>
          <InteractionCostPanel
            checkLabels={checkLabels}
            cost={priced.cost}
            roundLabel={t('acceptance.round', { round: priced.roundIndex })}
          />
        </div>
      )}
    </>
  );
});

AcceptanceInteractionCost.displayName = 'AcceptanceInteractionCost';

export default AcceptanceInteractionCost;
