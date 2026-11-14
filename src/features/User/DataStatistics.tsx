'use client';

import { type FlexboxProps } from '@lobehub/ui';
import { Badge, createStaticStyles, cssVar, Flexbox, Spin, Tooltip } from '@lobehub/ui';
import { isUndefined } from 'es-toolkit/compat';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useServerConfigStore } from '@/store/serverConfig';
import { statsActions, statsSelectors, useStatsStore } from '@/store/stats';
import { formatShortenNumber } from '@/utils/format';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorFillTertiary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  count: css`
    font-size: 16px;
    font-weight: bold;
    line-height: 1.2;
  `,
  title: css`
    font-size: 12px;
    line-height: 1.2;
    color: ${cssVar.colorTextDescription};
  `,
  today: css`
    font-size: 12px;
  `,
}));

const DataStatistics = memo<Omit<FlexboxProps, 'children'>>(({ style, ...rest }) => {
  const mobile = useServerConfigStore((s) => s.isMobile);
  statsActions.useFetchCount('agents');
  statsActions.useFetchCount('topics');
  statsActions.useFetchCount('messages');
  const agents = useStatsStore(statsSelectors.count('agents'))?.count;
  const topics = useStatsStore(statsSelectors.count('topics'))?.count;
  const { count: messages, today: messagesToday } =
    useStatsStore(statsSelectors.count('messages')) ?? {};

  const { t } = useTranslation('common');

  const loading = <Spin size="middle" />;

  const items = [
    {
      count: isUndefined(agents) ? loading : agents,
      key: 'sessions',
      title: t('dataStatistics.sessions'),
    },
    {
      count: isUndefined(topics) ? loading : topics,
      key: 'topics',
      title: t('dataStatistics.topics'),
    },
    {
      count: isUndefined(messages) ? loading : messages,
      countToady: messagesToday,
      key: 'messages',
      title: t('dataStatistics.messages'),
    },
  ];

  return (
    <Flexbox
      horizontal
      align={'center'}
      gap={4}
      paddingInline={8}
      style={{ marginBottom: 8, ...style }}
      width={'100%'}
      {...rest}
    >
      {items.map((item) => {
        if (item.key === 'messages') {
          const showBadge = Boolean(item.countToady && item.countToady > 0);
          return (
            <Flexbox
              horizontal
              align={'center'}
              className={styles.card}
              flex={showBadge && !mobile ? 2 : 1}
              gap={4}
              justify={'space-between'}
              key={item.key}
            >
              <Flexbox gap={2}>
                <div className={styles.count}>{formatShortenNumber(item.count)}</div>
                <div className={styles.title}>{item.title}</div>
              </Flexbox>
              {showBadge && (
                <Tooltip title={t('dataStatistics.today')}>
                  <Badge
                    count={`+${item.countToady}`}
                    style={{
                      background: cssVar.colorSuccess,
                      color: cssVar.colorSuccessBg,
                      cursor: 'pointer',
                    }}
                  />
                </Tooltip>
              )}
            </Flexbox>
          );
        }

        return (
          <Flexbox className={styles.card} flex={1} gap={2} key={item.key}>
            <Flexbox horizontal>
              <div className={styles.count}>{formatShortenNumber(item.count)}</div>
            </Flexbox>
            <div className={styles.title}>{item.title}</div>
          </Flexbox>
        );
      })}
    </Flexbox>
  );
});

export default DataStatistics;
