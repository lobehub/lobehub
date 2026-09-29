'use client';

import { Tag, Tooltip } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { WidgetHealth, WidgetHealthBadge } from '../utils/widgetHealth';

const BADGE_COLOR: Record<WidgetHealthBadge, string> = {
  failed: 'error',
  partial: 'warning',
  running: 'processing',
  stale: 'warning',
};

const StatusBadges = memo<{ health: WidgetHealth }>(({ health }) => {
  const { t } = useTranslation('dashboard');

  if (health.badges.length === 0) return null;

  return (
    <>
      {health.badges.map((badge) => {
        const tip =
          badge === 'failed'
            ? health.error?.message
              ? t('widget.status.failedTip', { message: health.error.message })
              : t('widget.status.failedTipNoMessage')
            : badge === 'partial'
              ? (health.partialMessage ?? t('widget.status.partialTip'))
              : t(`widget.status.${badge}Tip`);

        return (
          <Tooltip key={badge} title={tip}>
            <Tag color={BADGE_COLOR[badge]} data-widget-badge={badge} size={'small'}>
              {t(`widget.status.${badge}`)}
            </Tag>
          </Tooltip>
        );
      })}
    </>
  );
});

StatusBadges.displayName = 'DashboardWidgetStatusBadges';

export default StatusBadges;
