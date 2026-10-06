'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Text, Tooltip } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { LayoutGridIcon, RefreshCwIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { DashboardWidgetItem } from '@/services/dashboard';

import { dashboardPageStyles as pageStyles } from '../pageStyles';
import { getWidgetHealth, getWidgetUpdatedAt } from '../utils/widgetHealth';
import { getHealthTone, HEALTH_TONE_COLOR, type WidgetHealthTone } from '../WidgetCard/HealthDot';

const styles = createStaticStyles(({ css }) => ({
  dot: css`
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
  `,
  meta: css`
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
  sep: css`
    color: ${cssVar.colorTextQuaternary};
  `,
}));

/** Tones the summary calls out, in the order a reader should notice them. */
const SUMMARY_TONES = ['failed', 'stale', 'running', 'ok'] as const;

interface BoardHeaderProps {
  description?: string | null;
  /** Absent for viewers who cannot save the board's layout (not its creator). */
  onEditLayout?: () => void;
  onRefreshAll: () => void;
  refreshingAll: boolean;
  runnableCount: number;
  title?: string;
  widgets: DashboardWidgetItem[];
}

/**
 * The board's own heading: what it watches, how healthy its widgets are right
 * now and when it last heard from them, with the board-wide actions.
 */
const BoardHeader = memo<BoardHeaderProps>(
  ({ title, description, widgets, runnableCount, refreshingAll, onRefreshAll, onEditLayout }) => {
    const { t } = useTranslation('dashboard');

    const { counts, lastUpdatedAt } = useMemo(() => {
      const counts: Partial<Record<WidgetHealthTone, number>> = {};
      let lastUpdatedAt: number | undefined;
      for (const widget of widgets) {
        const tone = getHealthTone(getWidgetHealth(widget));
        counts[tone] = (counts[tone] ?? 0) + 1;
        const updatedAt = getWidgetUpdatedAt(widget);
        if (updatedAt) {
          const time = new Date(updatedAt).getTime();
          if (lastUpdatedAt === undefined || time > lastUpdatedAt) lastUpdatedAt = time;
        }
      }
      return { counts, lastUpdatedAt };
    }, [widgets]);

    return (
      <Flexbox
        data-dashboard-header
        horizontal
        align={'flex-end'}
        className={pageStyles.heading}
        gap={16}
        justify={'space-between'}
      >
        <Flexbox gap={6} style={{ minWidth: 0 }}>
          {title && <h1 className={pageStyles.title}>{title}</h1>}
          {description && <Text className={pageStyles.description}>{description}</Text>}
          <Flexbox horizontal align={'center'} className={styles.meta} gap={10} wrap={'wrap'}>
            <span>{t('board.widgetCount', { count: widgets.length })}</span>
            {SUMMARY_TONES.filter((tone) => counts[tone]).map((tone) => (
              <Flexbox horizontal align={'center'} data-dashboard-health={tone} gap={5} key={tone}>
                <span className={styles.dot} style={{ background: HEALTH_TONE_COLOR[tone] }} />
                {t(`board.health.${tone}`, { count: counts[tone] })}
              </Flexbox>
            ))}
            {lastUpdatedAt !== undefined && (
              <>
                <span className={styles.sep}>·</span>
                <Tooltip title={dayjs(lastUpdatedAt).format('YYYY-MM-DD HH:mm:ss')}>
                  <span>{t('board.lastUpdated', { time: dayjs(lastUpdatedAt).fromNow() })}</span>
                </Tooltip>
              </>
            )}
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal gap={8} style={{ flex: 'none' }}>
          <Button
            disabled={runnableCount === 0}
            icon={RefreshCwIcon}
            loading={refreshingAll}
            onClick={onRefreshAll}
          >
            {t('board.refreshAll')}
          </Button>
          {onEditLayout && (
            <Button icon={LayoutGridIcon} onClick={onEditLayout}>
              {t('layout.edit')}
            </Button>
          )}
        </Flexbox>
      </Flexbox>
    );
  },
);

BoardHeader.displayName = 'DashboardBoardHeader';

export default BoardHeader;
