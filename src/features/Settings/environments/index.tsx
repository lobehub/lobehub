'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { MAX_WIDTH } from '@/const/layoutTokens';
import EnvironmentManager from '@/features/EnvironmentManager';

/**
 * Thin: the titled group, the list and the detail panel all live in the manager,
 * the way the devices page composes its own. The group repeats the page's name
 * on purpose, for the same reason "My Devices" appears twice there — the header
 * bar scrolls away, the section heading does not.
 *
 * No gate: an environment is a definition, and writing one down needs no
 * drive. Only initializing a folder from it does, and that is asked where it
 * happens.
 */
const Page = memo(() => (
  <Flexbox style={{ maxWidth: MAX_WIDTH, width: '100%' }}>
    <EnvironmentManager />
  </Flexbox>
));

Page.displayName = 'EnvironmentsSetting';

export default Page;
