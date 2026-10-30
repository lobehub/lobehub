'use client';

import { AccordionRoot, Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import { pageActions, usePageStore } from '@/store/page';

import SidebarBody from './Body';
import PageSection from './Body/PageSection';
import FullListDrawer from './Body/PageSection/FullListDrawer';
import Header from './Header';

/**
 * Every page of a section, not just the first rows it lists. The sections only
 * carry a capped slice, and the home dashboard's mixed list is capped too, so
 * without this panel an older page pushed out of the slice has no listing that
 * can reach it. One panel serves both sections; the last one opened wins.
 */
const FullListDrawerHost = memo(() => {
  const { t } = useTranslation('file');
  const [open, scope] = usePageStore((s) => [s.sectionFullListOpen, s.sectionFullListScope]);

  return (
    <FullListDrawer
      open={open}
      scope={scope}
      title={t(scope === 'mine' ? 'docs.myDocs.title' : 'docs.shared.title')}
      onClose={pageActions.closeSectionFullList}
    />
  );
});

FullListDrawerHost.displayName = 'DocsFullListDrawerHost';

export enum GroupKey {
  Library = 'library',
  MyDocs = 'my-docs',
  Shared = 'shared-docs',
}

const DEFAULT_OPEN = [GroupKey.Library, GroupKey.MyDocs, GroupKey.Shared];

/**
 * Docs sidebar: the four sections in the header, then shortcuts — recent
 * libraries, the caller's own pages and (in a workspace) pages teammates shared.
 */
const ResourceSidebarContent = memo(() => {
  const workspaceId = useActiveWorkspaceId();

  return (
    <SideBarLayout
      header={<Header />}
      body={
        <>
          <Flexbox paddingBlock={8} paddingInline={4}>
            <AccordionRoot
              defaultValue={DEFAULT_OPEN}
              indicatorPlacement="inline"
              style={{ gap: 8 }}
            >
              <SidebarBody itemKey={GroupKey.Library} />
              <PageSection itemKey={GroupKey.MyDocs} scope={'mine'} />
              {workspaceId && <PageSection itemKey={GroupKey.Shared} scope={'shared'} />}
            </AccordionRoot>
          </Flexbox>
          <FullListDrawerHost />
        </>
      }
    />
  );
});

ResourceSidebarContent.displayName = 'ResourceSidebarContent';

export default ResourceSidebarContent;
