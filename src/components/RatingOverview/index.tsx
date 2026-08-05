'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Progress } from 'antd';
import { cssVar, useResponsive } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type SkillRatingDistribution } from '@/types/discover';
import { formatShortenNumber } from '@/utils/format';

import Rate from './Rate';

interface RatingOverviewProps {
  average?: number;
  distribution?: SkillRatingDistribution;
  totalCount?: number;
}

const RatingOverview = memo<RatingOverviewProps>(
  ({ average = 0, totalCount = 0, distribution }) => {
    const { t } = useTranslation('discover');
    const { mobile } = useResponsive();

    const displayAverage = Number(average.toFixed(1));
    const stars = [5, 4, 3, 2, 1] as const;

    return (
      <Flexbox gap={32} horizontal={!mobile}>
        <Flexbox align={'center'} gap={6} style={{ minWidth: 120 }}>
          <Text style={{ fontSize: 48, fontWeight: 'bold', lineHeight: 1.2 }}>
            {displayAverage.toFixed(1)}
          </Text>
          <Rate value={displayAverage} />
          <Text type={'secondary'}>
            {totalCount > 0
              ? t('skills.details.rating.totalRatings', {
                  count: formatShortenNumber(totalCount),
                } as any)
              : t('skills.details.rating.noRatings')}
          </Text>
        </Flexbox>
        <Flexbox flex={1} justify={'center'}>
          {stars.map((star) => {
            const count = distribution?.[star] ?? 0;
            const percent = totalCount > 0 ? (count / totalCount) * 100 : 0;
            return (
              <Flexbox horizontal align={'center'} gap={8} key={star}>
                <Text style={{ flexShrink: 0, width: 16 }} type={'secondary'}>
                  {star}
                </Text>
                <Progress
                  percent={percent}
                  showInfo={false}
                  size={'small'}
                  strokeColor={cssVar.colorWarning}
                  strokeWidth={8}
                  style={{ flex: 1, marginBottom: 0 }}
                />
              </Flexbox>
            );
          })}
        </Flexbox>
      </Flexbox>
    );
  },
);

export default RatingOverview;
