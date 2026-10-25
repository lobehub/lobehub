'use client';

import { Text } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMatches } from 'react-router';

import { findRouteTitleKey } from './routeTitle';

/**
 * On desktop the sidebar tells the user where they are; a full-screen mobile
 * page whose header has no title of its own names the route instead.
 */
const MobileRouteTitle = memo(() => {
  const { t } = useTranslation('electron');
  const matches = useMatches();
  const titleKey = useMemo(() => findRouteTitleKey(matches.map((m) => m.handle)), [matches]);

  if (!titleKey) return null;
  const title = t(titleKey as any);
  if (title === titleKey) return null;

  return (
    <Text ellipsis weight={500}>
      {title}
    </Text>
  );
});

MobileRouteTitle.displayName = 'MobileRouteTitle';

export default MobileRouteTitle;
