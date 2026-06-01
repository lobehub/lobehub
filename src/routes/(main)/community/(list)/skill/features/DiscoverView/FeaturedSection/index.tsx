'use client';

import { Flexbox, Grid } from '@lobehub/ui';
import { Skeleton } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Title from '@/routes/(main)/community/components/Title';
import { useDiscoverStore } from '@/store/discover';
import { SkillSorts } from '@/types/discover';

import FeaturedCard from './FeaturedCard';

const FeaturedSection = memo(() => {
  const { t } = useTranslation('discover');
  const useFetchSkillList = useDiscoverStore((s) => s.useFetchSkillList);

  const { data, isLoading } = useFetchSkillList({
    order: 'desc',
    page: 1,
    pageSize: 6,
    sort: SkillSorts.InstallCount,
  });

  if (isLoading) {
    return (
      <Flexbox gap={16}>
        <Title>{t('skills.sections.featured')}</Title>
        <Grid rows={3} width={'100%'}>
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton.Button active block key={index} style={{ height: 160 }} />
          ))}
        </Grid>
      </Flexbox>
    );
  }

  if (!data?.items?.length) return null;

  return (
    <Flexbox gap={16}>
      <Title more={t('skills.sections.seeAll')} moreLink={'/community/skill?sort=createdAt'}>
        {t('skills.sections.featured')}
      </Title>
      <Grid rows={3} width={'100%'}>
        {data.items.slice(0, 6).map((item) => (
          <FeaturedCard key={item.identifier} {...item} />
        ))}
      </Grid>
    </Flexbox>
  );
});

export default FeaturedSection;
