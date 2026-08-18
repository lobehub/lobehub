'use client';

import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatMessageCostUsd } from '@/features/Conversation/Messages/components/resolveMessageCost';

const styles = createStaticStyles(({ css, cssVar }) => ({
  badge: css`
    position: absolute;
    z-index: 5;
    inset-block-end: 8px;
    inset-inline-start: 8px;

    padding-block: 2px;
    padding-inline: 6px;
    border-radius: 6px;

    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorText};

    background: ${cssVar.colorBgElevated};
  `,
}));

export const GenerationCostBadge = memo<{ costUsd?: number; namespace?: 'image' | 'video' }>(
  ({ costUsd, namespace = 'image' }) => {
    const { t } = useTranslation(namespace);
    if (typeof costUsd !== 'number' || !Number.isFinite(costUsd)) return null;

    return (
      <span className={styles.badge} title={t('generation.cost')}>
        {formatMessageCostUsd(costUsd)}
      </span>
    );
  },
);

GenerationCostBadge.displayName = 'GenerationCostBadge';
