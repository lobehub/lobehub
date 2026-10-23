import { Outlet } from 'react-router';

import MobileContentLayout from '@/components/server/MobileNavLayout';

import { MobileGroupHeader } from './Header';

// Group init, id sync and the 404 guard live one level up in the group scope
// layout (`MobileShell/GroupScopeLayout`), which the chat shares with the
// profile and permission pages.
export const MobileGroupLayout = () => (
  <MobileContentLayout header={<MobileGroupHeader />} style={{ overflowY: 'hidden' }}>
    <Outlet />
  </MobileContentLayout>
);
