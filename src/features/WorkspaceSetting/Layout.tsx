'use client';

import { type FC, memo } from 'react';
import { Outlet } from 'react-router-dom';

import Container from './Container';
import SideBar from './SideBar';

/**
 * Bare workspace settings shell — sidebar + outlet, no content padding.
 * Use this when a child route owns its own full-bleed layout (e.g. Provider).
 */
const WorkspaceSettingsLayout: FC = memo(() => {
  return (
    <>
      <SideBar />
      <Outlet />
    </>
  );
});

WorkspaceSettingsLayout.displayName = 'WorkspaceSettingsLayout';

/**
 * Padded content layout — wraps the outlet in a centered, max-width
 * `WorkspaceSettingsContainer`. Mount this above routes that follow the
 * standard "header + form" page pattern (general, members, billing, etc.).
 */
const WorkspaceSettingsContentLayout: FC = memo(() => {
  return (
    <Container maxWidth={1024} paddingBlock={'24px 128px'} paddingInline={24}>
      <Outlet />
    </Container>
  );
});

WorkspaceSettingsContentLayout.displayName = 'WorkspaceSettingsContentLayout';

export { WorkspaceSettingsContentLayout };

export default WorkspaceSettingsLayout;
