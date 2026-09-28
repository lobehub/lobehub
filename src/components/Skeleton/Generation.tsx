'use client';

import { Flexbox, Grid } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { useLocation } from 'react-router';

import type { RouteSkeletonProps } from '@/spa/router/routeMeta';

import SkeletonBar from './Bar';
import SkeletonContainer from './Conversation/Container';

const HeaderSkeleton = () => (
  <Flexbox
    horizontal
    align={'center'}
    flex={'none'}
    height={44}
    justify={'space-between'}
    paddingInline={16}
  >
    <SkeletonBar height={20} width={120} />
    <SkeletonBar height={28} width={28} />
  </Flexbox>
);

/**
 * No `?topic=`: `CreateGenerationPage` renders a single prompt input centered in
 * the viewport, with the title above it — no feed, and no panel of its own. The
 * generation sidebar is portal'd into the app shell's nav panel, so a fallback
 * that draws one inside the content area invents chrome the page never had.
 */
const HomeSkeleton = () => (
  <SkeletonContainer
    align={'center'}
    justify={'center'}
    style={{ minHeight: 'calc(100vh - 180px)' }}
  >
    <SkeletonBar height={32} width={280} />
    <div style={{ height: 24 }} />
    <SkeletonBar height={148} radius={cssVar.borderRadiusLG} />
  </SkeletonContainer>
);

/** With a topic: the batch feed above, the prompt input pinned below. */
const TopicSkeleton = () => (
  <SkeletonContainer flex={1} gap={16} paddingBlock={16}>
    <SkeletonBar height={20} width={'95%'} />
    <Flexbox horizontal gap={12}>
      <SkeletonBar height={16} width={120} />
      <SkeletonBar height={16} width={80} />
      <SkeletonBar height={16} width={60} />
      <SkeletonBar height={16} width={70} />
    </Flexbox>
    <Grid maxItemWidth={200} rows={4} width={'100%'}>
      {Array.from({ length: 4 }).map((_, index) => (
        <SkeletonBar height={200} key={index} radius={cssVar.borderRadiusLG} />
      ))}
    </Grid>
    <div style={{ flex: 1 }} />
    <SkeletonBar height={148} radius={cssVar.borderRadiusLG} />
  </SkeletonContainer>
);

const GenerationSkeleton = ({ chrome = 'page' }: RouteSkeletonProps) => {
  const { search } = useLocation();
  const isHome = !new URLSearchParams(search).get('topic');

  return (
    <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
      {chrome !== 'body' && <HeaderSkeleton />}
      <Flexbox flex={1} style={{ minHeight: 0, overflow: 'hidden' }}>
        {isHome ? <HomeSkeleton /> : <TopicSkeleton />}
      </Flexbox>
    </Flexbox>
  );
};

export default GenerationSkeleton;
