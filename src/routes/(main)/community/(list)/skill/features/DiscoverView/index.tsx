'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import CollectionsSection from './CollectionsSection';
import EditorsPick from './EditorsPick';
import FeaturedSection from './FeaturedSection';
import TrendingSection from './TrendingSection';

const DiscoverView = memo(() => {
  return (
    <Flexbox gap={40} width={'100%'}>
      <EditorsPick />
      <TrendingSection />
      <FeaturedSection />
      <CollectionsSection />
    </Flexbox>
  );
});

export default DiscoverView;
