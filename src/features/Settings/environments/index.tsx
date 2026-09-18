'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { MAX_WIDTH } from '@/const/layoutTokens';
import EnvironmentManager from '@/features/EnvironmentManager';

/**
 * Thin: the group, its title and its create action all live in the manager,
 * the way the workspace budget page composes its groups. Wrapping it in a
 * `Form` would lay it out as a form ITEM and give it none of an item's padding.
 */
const Page = memo(() => (
  <Flexbox style={{ maxWidth: MAX_WIDTH, width: '100%' }}>
    <EnvironmentManager />
  </Flexbox>
));

Page.displayName = 'EnvironmentsSetting';

export default Page;
