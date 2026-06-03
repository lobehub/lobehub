import { Block, Flexbox, Skeleton } from '@lobehub/ui';
import { Divider } from 'antd';
import { cssVar } from 'antd-style';
import { Fragment, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { formatShortenNumber } from '@/utils/format';

import { HeatmapType } from '../../types';

/**
 * Render a wall-clock duration in seconds as a compact "1h 15m" / "15m 20s" /
 * "45s" string. Returns '--' when there is nothing to show.
 */
const formatDuration = (seconds?: number) => {
  if (!seconds || seconds < 1) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

/**
 * Token-dimension summary row for the activity heatmap. The peak / streak figures
 * are derived from the daily token-heatmap series (same SWR key as the heatmap,
 * so the request is deduped); the longest-task duration comes from the agent
 * operations' wall-clock time. The cumulative token total lives in the overview
 * cards above, so it is intentionally not repeated here.
 */
const HeatmapStats = memo(() => {
  const { t } = useTranslation('auth');

  const { data, isLoading } = useClientDataSWR(
    ['stats-heatmaps', HeatmapType.Tokens].join('-'),
    () => messageService.getTokenHeatmaps(),
  );
  const loading = isLoading || !data;

  const { data: maxTaskDuration } = useClientDataSWR('stats-max-task-duration', () =>
    topicService.getMaxTaskDuration(),
  );

  const stats = useMemo(() => {
    if (!data?.length) return { current: 0, longest: 0, peak: 0 };

    let peak = 0;
    let longest = 0;
    let run = 0;
    for (const item of data) {
      if (item.count > peak) peak = item.count;
      if (item.count > 0) {
        run += 1;
        if (run > longest) longest = run;
      } else {
        run = 0;
      }
    }

    // Current streak: trailing consecutive active days. The last bucket (today)
    // may legitimately be 0 because the day isn't over, so it doesn't break it.
    let current = 0;
    for (let i = data.length - 1; i >= 0; i -= 1) {
      if (data[i].count > 0) current += 1;
      else if (i === data.length - 1) continue;
      else break;
    }

    return { current, longest, peak };
  }, [data]);

  const days = (n: number) => [n, t('stats.days')].join(' ');

  const items = [
    { label: t('stats.heatmapStats.peakTokens'), value: formatShortenNumber(stats.peak) },
    {
      label: t('stats.heatmapStats.longestTask'),
      loading: maxTaskDuration === undefined,
      value: formatDuration(maxTaskDuration),
    },
    { label: t('stats.heatmapStats.currentStreak'), value: days(stats.current) },
    { label: t('stats.heatmapStats.longestStreak'), value: days(stats.longest) },
  ];

  return (
    <Block paddingBlock={16} paddingInline={8} variant={'outlined'}>
      <Flexbox horizontal align={'center'} width={'100%'}>
        {items.map((item, index) => (
          <Fragment key={item.label}>
            {index > 0 && <Divider style={{ height: 32, margin: 0 }} type={'vertical'} />}
            <Flexbox align={'center'} flex={1} gap={4}>
              <div style={{ fontSize: 20, fontWeight: 'bold' }}>
                {loading || item.loading ? (
                  <Skeleton.Button active size={'small'} style={{ width: 56 }} />
                ) : (
                  item.value
                )}
              </div>
              <div style={{ color: cssVar.colorTextDescription, fontSize: 12 }}>{item.label}</div>
            </Flexbox>
          </Fragment>
        ))}
      </Flexbox>
    </Block>
  );
});

export default HeatmapStats;
