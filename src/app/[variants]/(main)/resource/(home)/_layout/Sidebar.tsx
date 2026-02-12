'use client';

import { Accordion, Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { NavPanelPortal } from '@/features/NavPanel';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import SidebarBody from './Body';
import Header from './Header';

export enum GroupKey {
  Library = 'library',
}

const Sidebar = memo(() => {
  return (
    <NavPanelPortal navKey="resource">
      <SideBarLayout
        header={<Header />}
        body={
          <Flexbox paddingBlock={8} paddingInline={4}>
            <Accordion defaultExpandedKeys={[GroupKey.Library]} gap={8}>
              <SidebarBody itemKey={GroupKey.Library} />
            </Accordion>
          </Flexbox>
        }
      />
    </NavPanelPortal>
  );
});

Sidebar.displayName = 'ResourceHomeSidebar';

export default Sidebar;
