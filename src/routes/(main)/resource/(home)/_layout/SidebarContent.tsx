'use client';

import { Accordion, Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import SidebarBody from './Body';
import Header from './Header';

export enum GroupKey {
  Library = 'library',
}

const ResourceSidebarContent = memo(() => (
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
));

ResourceSidebarContent.displayName = 'ResourceSidebarContent';

export default ResourceSidebarContent;
