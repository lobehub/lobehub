'use client';

import { Flexbox, Icon } from '@lobehub/ui';
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
 * Collapsed by default: it informs a decision, it is not the decision.
 */

const styles = createStaticStyles(({ css }) => ({
  body: css`
    padding-block: 0 12px;
    padding-inline: 12px;
  `,
  chevron: css`
    color: ${cssVar.colorTextQuaternary};
    transition: transform 0.15s ease;

    &[data-open='true'] {
      transform: rotate(90deg);
    }
  `,
  metric: css`
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};

    b {
      font-weight: 600;
      color: ${cssVar.colorTextSecondary};
    }
  `,
  root: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  round: css`
    padding-block: 1px;
    padding-inline: 6px;
    border-radius: 99px;

    font-size: 11px;
    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorFillTertiary};
  `,
  summary: css`
    cursor: pointer;
    padding-block: 10px;
    padding-inline: 12px;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  title: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
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
    <div className={styles.root}>
      <Flexbox
        horizontal
        align={'center'}
        className={styles.summary}
        gap={8}
        role={'button'}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Icon className={styles.chevron} data-open={open} icon={ChevronRight} size={13} />
        <span className={styles.title}>{t('report.interaction.title')}</span>
        <span className={styles.round}>{t('acceptance.round', { round: priced.roundIndex })}</span>
        <Flexbox flex={1} />
        <span className={styles.metric}>
          <b>{formatSeconds(priced.cost.totalSeconds)}</b>
        </span>
        <span className={styles.metric}>
          {t('report.interaction.active')} {formatSeconds(priced.cost.activeSeconds)}
        </span>
        <span className={styles.metric}>
          {t('report.interaction.wait')} {formatSeconds(priced.cost.waitSeconds)}
        </span>
      </Flexbox>
      {open && (
        <div className={styles.body}>
          <InteractionCostPanel checkLabels={checkLabels} cost={priced.cost} />
        </div>
      )}
    </div>
  );
});

AcceptanceInteractionCost.displayName = 'AcceptanceInteractionCost';

export default AcceptanceInteractionCost;
