'use client';

import { Text } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useMatches } from 'react-router';

import { findRouteTitleKey } from './routeTitle';
import { useRouteTitle } from './useRouteTitle';

/**
 * On desktop the sidebar tells the user where they are; a full-screen mobile
 * page whose header has no title of its own names the route instead.
 */
const MobileRouteTitle = memo(() => {
  const matches = useMatches();
  const titleKey = useMemo(() => findRouteTitleKey(matches.map((m) => m.handle)), [matches]);
  const title = useRouteTitle(titleKey);

  if (!title) return null;

  return (
    <Text ellipsis weight={500}>
      {title}
    </Text>
  );
});

MobileRouteTitle.displayName = 'MobileRouteTitle';

export default MobileRouteTitle;
