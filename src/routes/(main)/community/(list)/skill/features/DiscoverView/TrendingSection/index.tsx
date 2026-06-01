'use client';

import { Flexbox, Grid } from '@lobehub/ui';
import { Skeleton } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Title from '@/routes/(main)/community/components/Title';
import { useDiscoverStore } from '@/store/discover';
import { SkillSorts } from '@/types/discover';

import TrendingCard from './TrendingCard';

const TrendingSection = memo(() => {
  const { t } = useTranslation('discover');
  const useFetchSkillList = useDiscoverStore((s) => s.useFetchSkillList);

  const { data, isLoading } = useFetchSkillList({
    order: 'desc',
    page: 1,
    pageSize: 4,
    sort: SkillSorts.InstallCount,
  });

  if (isLoading) {
    return (
      <Flexbox gap={16}>
        <Title>{t('skills.sections.trending')}</Title>
        <Grid maxItemWidth={300} rows={2} width={'100%'}>
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton.Button active block key={index} style={{ height: 72 }} />
          ))}
        </Grid>
      </Flexbox>
    );
  }

  if (!data?.items?.length) return null;

  return (
    <Flexbox gap={16}>
      <Title more={t('skills.sections.seeAll')} moreLink={'/community/skill?sort=installCount'}>
        {t('skills.sections.trending')}
      </Title>
      <Grid maxItemWidth={300} rows={2} width={'100%'}>
        {data.items.slice(0, 4).map((item, index) => (
          <TrendingCard key={item.identifier} rank={index + 1} {...item} />
        ))}
      </Grid>
    </Flexbox>
  );
});

export default TrendingSection;
