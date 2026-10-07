'use client';

import type { AgentEvalRunListItem } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { Columns3, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import ModelLabel from '@/features/Eval/components/ModelLabel';
import StatusBadge from '@/features/Eval/StatusBadge';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import { getRunModels, getRunPassRate, isComparisonRun } from './runHelpers';

const MAX_MODELS = 2;

export const styles = createStaticStyles(({ css }) => ({
  cell: css`
    min-width: 0;
  `,
  kindIcon: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  more: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;
  `,
  number: css`
    font-family: ${cssVar.fontFamilyCode};
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorText};
    text-align: end;
  `,
  row: css`
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 2fr) 72px 112px 96px;
    gap: 16px;
    align-items: center;

    padding-block: 12px;
    padding-inline: 16px;

    color: inherit;
    text-decoration: none;

    transition: background 0.15s ease;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }

    @media (width <= 900px) {
      grid-template-columns: minmax(0, 1fr) 72px 112px;

      & > [data-col='models'],
      & > [data-col='time'] {
        display: none;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  time: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
    text-align: end;
    white-space: nowrap;
  `,
}));

interface RecentRunRowProps {
  href: string;
  run: AgentEvalRunListItem;
}

const RecentRunRow = ({ href, run }: RecentRunRowProps) => {
  const { t } = useTranslation('eval');
  const comparison = isComparisonRun(run);
  const models = getRunModels(run);
  const passRate = getRunPassRate(run);
  const kind = comparison ? t('home.recent.kind.comparison') : t('home.recent.kind.run');
  const title = run.name || run.datasetName || kind;

  return (
    <WorkspaceLink className={styles.row} data-testid="eval-home-recent-run" to={href}>
      <Flexbox horizontal align="center" className={styles.cell} gap={12}>
        <div className={styles.kindIcon}>
          <Icon icon={comparison ? Columns3 : Play} size={14} />
        </div>
        <Flexbox className={styles.cell} gap={2}>
          <Text ellipsis weight={500}>
            {title}
          </Text>
          <Text ellipsis fontSize={12} type="secondary">
            {run.datasetName && run.datasetName !== title ? `${kind} · ${run.datasetName}` : kind}
          </Text>
        </Flexbox>
      </Flexbox>

      <Flexbox horizontal align="center" className={styles.cell} data-col="models" gap={12}>
        {models.length === 0 ? (
          <span className={styles.more}>{t('home.recent.noModel')}</span>
        ) : (
          <>
            {models.slice(0, MAX_MODELS).map((m) => (
              <ModelLabel
                key={`${m.provider}/${m.model}`}
                model={m.model}
                provider={m.provider}
                showProvider={models.length === 1}
                size={16}
              />
            ))}
            {models.length > MAX_MODELS && (
              <span className={styles.more}>+{models.length - MAX_MODELS}</span>
            )}
          </>
        )}
      </Flexbox>

      <span className={styles.number} title={t('home.recent.passRate')}>
        {passRate === undefined ? '—' : `${Math.round(passRate * 100)}%`}
      </span>

      <Flexbox horizontal align="center">
        <StatusBadge status={run.status} />
      </Flexbox>

      <span className={styles.time} data-col="time" title={dayjs(run.createdAt).format('LLL')}>
        {dayjs(run.createdAt).fromNow()}
      </span>
    </WorkspaceLink>
  );
};

export default RecentRunRow;
