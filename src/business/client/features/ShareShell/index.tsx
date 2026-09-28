'use client';

import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { type ReactNode } from 'react';

export interface ShareHeroProps {
  avatar?: ReactNode;
  byline?: ReactNode;
  title?: string | null;
}

export const ShareHero = ({ avatar, byline, title }: ShareHeroProps) => (
  <Flexbox gap={8} paddingBlock={'calc(24px + var(--share-header-overlap, 0px)) 16px'}>
    {avatar}
    {title && (
      <Text as={'h1'} fontSize={24} style={{ margin: 0 }} weight={700}>
        {title}
      </Text>
    )}
    {byline && (
      <Text fontSize={12} type={'secondary'}>
        {byline}
      </Text>
    )}
  </Flexbox>
);
