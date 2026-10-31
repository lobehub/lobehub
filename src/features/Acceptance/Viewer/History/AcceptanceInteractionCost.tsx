'use client';

import { Button, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AcceptanceBundle } from '@/services/verify';

import InteractionCostPanel from '../../Report/InteractionCost';
import { formatSeconds } from '../../Report/interactionCostModel';
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

const styles = stylex.create({
  body: {
    paddingBlockEnd: '4px',
    paddingInlineStart: '24px',
  },
  chevron: {
    transition: 'transform 0.15s ease',
  },
  chevronOpen: {
    transform: 'rotate(90deg)',
  },
  total: {
    marginInlineStart: '6px',
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorTextTertiary,
  },
});

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
        size={'small'}
        style={{ alignSelf: 'flex-start' }}
        type={'text'}
        icon={
          <Icon
            data-open={open}
            icon={ChevronRight}
            {...stylex.props(styles.chevron, open && styles.chevronOpen)}
          />
        }
        onClick={() => setOpen((prev) => !prev)}
      >
        {t('report.interaction.title')}
        <span {...stylex.props(styles.total)}>{formatSeconds(priced.cost.totalSeconds)}</span>
      </Button>
      {open && (
        <div {...stylex.props(styles.body)}>
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
