'use client';

import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { memo, type ReactNode } from 'react';

interface TabPaneProps {
  children: ReactNode;
  desc?: ReactNode;
}

/**
 * The body of a tab that holds one thing.
 *
 * The tab strip already names it, so a rail heading under the strip said the
 * same words twice with an icon between them. Only the settings tab keeps the
 * rail, because it holds several sections and the rail is what tells them apart.
 */
const TabPane = memo<TabPaneProps>(({ children, desc }) => (
  <Flexbox gap={16} paddingBlock={'4px 24px'}>
    {desc && (
      <Text fontSize={12} type={'secondary'}>
        {desc}
      </Text>
    )}
    {children}
  </Flexbox>
));

TabPane.displayName = 'TabPane';

export default TabPane;
