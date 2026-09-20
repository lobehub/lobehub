'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { MAX_WIDTH } from '@/const/layoutTokens';
import EnvironmentManager from '@/features/EnvironmentManager';
import EnvironmentsGate from '@/features/EnvironmentManager/EnvironmentsGate';

/**
 * Thin: the toolbar, the list and the detail panel all live in the manager, the
 * way the devices page composes its own. The page's heading comes from the
 * settings route (`tab.environments`), so nothing here repeats it.
 */
const Page = memo(() => (
  <Flexbox style={{ maxWidth: MAX_WIDTH, width: '100%' }}>
    <EnvironmentsGate>
      <EnvironmentManager />
    </EnvironmentsGate>
  </Flexbox>
));

Page.displayName = 'EnvironmentsSetting';

export default Page;
