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

interface StatusBadgesProps {
  /** Subset of `health.badges` to show, when the host already conveys some of them. */
  badges?: WidgetHealthBadge[];
  health: WidgetHealth;
}

const StatusBadges = memo<StatusBadgesProps>(({ health, badges = health.badges }) => {
  const { t } = useTranslation('dashboard');

  if (badges.length === 0) return null;

  return (
    <>
      {badges.map((badge) => {
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
