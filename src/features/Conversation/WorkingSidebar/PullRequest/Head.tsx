import type { DeviceGitLinkedPullRequest } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { rowStyles } from '../Overview/OverviewRow';
import { sectionStyles } from '../Overview/sectionStyles';
import { getDetailVisual } from './prVisual';

export const headStyles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`
    flex-shrink: 0;
    margin-block-start: -2px;
  `,
  meta: css`
    flex-wrap: wrap;

    margin-block-start: 6px;

    font-size: 12px;
    line-height: 18px;
    color: ${cssVar.colorTextTertiary};
  `,
  ref: css`
    overflow: hidden;

    max-width: 160px;
    padding-block: 1px;
    padding-inline: 6px;
    border-radius: 4px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillSecondary};
  `,
  refButton: css`
    cursor: pointer;
    display: inline-flex;
    gap: 3px;
    align-items: center;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  root: css`
    padding-block: 10px 8px;
    padding-inline: 8px;
  `,
  stats: css`
    font-variant-numeric: tabular-nums;
  `,
  title: css`
    flex: 1;

    min-width: 0;

    font-size: 15px;
    font-weight: 600;
    line-height: 22px;
    color: ${cssVar.colorText};
    overflow-wrap: anywhere;
  `,
}));

export const PrTitle = memo<{ number: number; title: string }>(({ number, title }) => (
  <span className={headStyles.title}>
    <span className={rowStyles.num}>#{number}</span>
    {title}
  </span>
));

PrTitle.displayName = 'PrTitle';

export const PrStatePill = memo<{
  pr: Pick<DeviceGitLinkedPullRequest, 'isDraft' | 'mergedAt' | 'state'>;
}>(({ pr }) => {
  const { t } = useTranslation('chat');
  const visual = getDetailVisual(pr);
  return (
    <span
      className={sectionStyles.pill}
      style={{
        background: `color-mix(in srgb, ${visual.color} 12%, transparent)`,
        color: visual.color,
      }}
    >
      <Icon icon={visual.icon} size={12} />
      {t(`workingPanel.pr.state.${visual.state}`)}
    </span>
  );
});

PrStatePill.displayName = 'PrStatePill';

interface PrHeadProps {
  actions?: ReactNode;
  meta: ReactNode;
  title: ReactNode;
}

const PrHead = memo<PrHeadProps>(({ actions, meta, title }) => (
  <div className={headStyles.root}>
    <Flexbox horizontal align={'flex-start'} gap={6}>
      {title}
      {actions && (
        <Flexbox horizontal className={headStyles.actions} gap={2}>
          {actions}
        </Flexbox>
      )}
    </Flexbox>
    <Flexbox horizontal align={'center'} className={headStyles.meta} gap={6}>
      {meta}
    </Flexbox>
  </div>
));

PrHead.displayName = 'PrHead';

export default PrHead;
