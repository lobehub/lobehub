'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { MAX_WIDTH } from '@/const/layoutTokens';
import EnvironmentManager from '@/features/EnvironmentManager';

/**
 * Thin: the titled group, the list and the detail panel all live in the manager.
 * The group heading carries the list's Refresh and New actions, so it stays even
 * though the shared settings header already names the page.
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
