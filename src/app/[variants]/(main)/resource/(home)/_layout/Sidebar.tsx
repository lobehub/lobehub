'use client';

import { Accordion, Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { NavPanelPortal } from '@/features/NavPanel';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Collection from './Body/KnowledgeBase';
import Header from './Header';

export enum GroupKey {
  Library = 'library',
}

const Sidebar = memo(() => {
  return (
    <NavPanelPortal navKey="resource">
      <SideBarLayout
        body={
          <Flexbox paddingBlock={8} paddingInline={4}>
            <Accordion defaultExpandedKeys={[GroupKey.Library]} gap={8}>
              <Collection itemKey={GroupKey.Library} />
            </Accordion>
          </Flexbox>
        }
        header={<Header />}
      />
    </NavPanelPortal>
  );
});

Sidebar.displayName = 'ResourceHomeSidebar';

export default Sidebar;
