'use client';

import { Flexbox } from '@lobehub/ui';
import { AccordionRoot } from '@lobehub/ui/base-ui';
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
        <AccordionRoot
          defaultValue={[GroupKey.Library]}
          indicatorPlacement="inline"
          style={{ gap: 8 }}
        >
          <SidebarBody itemKey={GroupKey.Library} />
        </AccordionRoot>
      </Flexbox>
    }
  />
));

ResourceSidebarContent.displayName = 'ResourceSidebarContent';

export default ResourceSidebarContent;
