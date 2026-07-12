'use client';

import { Accordion, Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import SidebarBody from './Body';
import Header from './Header';
import WorkBody from './WorkBody';

export enum GroupKey {
  Library = 'library',
  Work = 'work',
}

const ResourceSidebarContent = memo(() => (
  <SideBarLayout
    header={<Header />}
    body={
      <Flexbox paddingBlock={8} paddingInline={4}>
        <Accordion defaultExpandedKeys={[GroupKey.Library, GroupKey.Work]} gap={8}>
          <SidebarBody itemKey={GroupKey.Library} />
          <WorkBody itemKey={GroupKey.Work} />
        </Accordion>
      </Flexbox>
    }
  />
));

ResourceSidebarContent.displayName = 'ResourceSidebarContent';

export default ResourceSidebarContent;
