'use client';

import { Block, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import Loading from '@/components/Loading/BrandTextLoading';

import { useExpertiseDomain, useExpertiseLessons } from './hooks';
import LayerCoverage from './LayerCoverage';
import LearningCurve from './LearningCurve';
import MaturityBadge from './MaturityBadge';
import RuleList from './RuleList';

interface DomainDetailProps {
  domainId: string;
}

const DomainDetail = memo<DomainDetailProps>(({ domainId }) => {
  const { t } = useTranslation('selfLearning');
  const { data, error, isLoading, mutate } = useExpertiseDomain(domainId);
  const { data: lessons, isLoading: lessonsLoading } = useExpertiseLessons(domainId);

  return (
    <AsyncBoundary
      data={data}
      error={error}
      errorVariant={'page'}
      isLoading={isLoading}
      loading={<Loading debugId="SelfLearningDomain" />}
      onRetry={() => mutate()}
    >
      {data && (
        <Flexbox gap={16} paddingBlock={16}>
          <Block gap={12} padding={20} variant={'outlined'}>
            <Flexbox horizontal align={'flex-start'} gap={24} justify={'space-between'}>
              <Flexbox gap={4} style={{ minWidth: 0 }}>
                <Text fontSize={16} weight={600}>
                  {data.domain.title}
                </Text>
                {data.domain.description && (
                  <Text fontSize={13} type={'secondary'}>
                    {data.domain.description}
                  </Text>
                )}
                <Text fontSize={12} type={'secondary'}>
                  {t('summary.practices', { count: data.runs.length })}
                </Text>
              </Flexbox>
              <Flexbox style={{ flexShrink: 0 }}>
                <Text fontSize={12} type={'secondary'}>
                  {t('maturity.title')}
                </Text>
                <MaturityBadge
                  lessonCount={lessons?.length ?? 0}
                  maturity={data.maturity}
                  size={'large'}
                />
              </Flexbox>
            </Flexbox>
          </Block>

          {/* 还没定锚点时不画曲线也不列规则 —— 领域是选择不是发现，人没选方向之前
              长出来的规则属于哪个领域是没有答案的。 */}
          {data.domain.anchorChosenAt ? (
            <>
              <LearningCurve maturity={data.maturity} series={data.series} />
              <LayerCoverage detail={data} />
              {!lessonsLoading && lessons && lessons.length > 0 && <RuleList lessons={lessons} />}
            </>
          ) : (
            <Block gap={8} padding={20} variant={'outlined'}>
              <Text weight={600}>{t('anchor.pending')}</Text>
              <Text fontSize={13} type={'secondary'}>
                {t('anchor.pendingDesc')}
              </Text>
            </Block>
          )}
        </Flexbox>
      )}
    </AsyncBoundary>
  );
});

DomainDetail.displayName = 'DomainDetail';

export default DomainDetail;
