'use client';

import { Text } from '@lobehub/ui/base-ui';
import { type FC, memo } from 'react';
import { Outlet, useMatch } from 'react-router';
import { SWRConfig } from 'swr';

import SuspenseRouteBoundary from '@/components/SuspenseRouteBoundary';
import NavHeader from '@/features/NavHeader';
import { RouteSkeletonChromeProvider } from '@/spa/router/routeSkeletonChrome';
import { WorkspaceSettingsTabs } from '@/types/workspaceSettings';

import Container from './Container';
import { useWorkspaceSettingCategory } from './hooks/useCategory';
import SideBar from './SideBar';

const COMPACT_HEADER_TABS = new Set<string>([
  WorkspaceSettingsTabs.APIKey,
  WorkspaceSettingsTabs.Billing,
  WorkspaceSettingsTabs.Budget,
  WorkspaceSettingsTabs.Creds,
  WorkspaceSettingsTabs.Credits,
  WorkspaceSettingsTabs.Devices,
  WorkspaceSettingsTabs.General,
  WorkspaceSettingsTabs.Labels,
  WorkspaceSettingsTabs.Members,
  WorkspaceSettingsTabs.Notification,
  WorkspaceSettingsTabs.Plans,
  WorkspaceSettingsTabs.ServiceModel,
  WorkspaceSettingsTabs.Stats,
  WorkspaceSettingsTabs.Storage,
  WorkspaceSettingsTabs.Usage,
]);

/**
 * Bare workspace settings shell — sidebar + outlet, no content padding.
 * Use this when a child route owns its own full-bleed layout (e.g. Provider).
 */
const WorkspaceSettingsLayout: FC = () => {
  return (
    <>
      <SideBar />
      <SWRConfig value={{ suspense: true }}>
        <SuspenseRouteBoundary>
          <RouteSkeletonChromeProvider>
            <Outlet />
          </RouteSkeletonChromeProvider>
        </SuspenseRouteBoundary>
      </SWRConfig>
    </>
  );
};

/**
 * Standard workspace settings content layout. Compact-header tabs use the
 * shared navigation header above a centered, max-width content container;
 * other tabs keep the existing content-only wrapper.
 */
const WorkspaceSettingsContentLayout: FC = memo(() => {
  const categories = useWorkspaceSettingCategory();
  const match = useMatch('/:workspaceSlug/settings/:tab/*');
  const activeTab = match?.params.tab;
  const title = categories
    .flatMap((category) => category.items)
    .find((item) => item.key === activeTab)?.label;

  const content = (
    <Container maxWidth={1024} paddingBlock={'24px 128px'} paddingInline={24}>
      <Outlet />
    </Container>
  );

  if (!activeTab || !COMPACT_HEADER_TABS.has(activeTab)) return content;

  return (
    <>
      <NavHeader styles={{ center: { alignItems: 'center' } }}>
        {title && <Text weight={500}>{title}</Text>}
      </NavHeader>
      {content}
    </>
  );
});

WorkspaceSettingsContentLayout.displayName = 'WorkspaceSettingsContentLayout';

export { WorkspaceSettingsContentLayout };

export default WorkspaceSettingsLayout;
