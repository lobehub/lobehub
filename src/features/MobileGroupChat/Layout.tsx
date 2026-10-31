import { Outlet } from 'react-router';

import MobileContentLayout from '@/components/server/MobileNavLayout';
import { GroupNotFoundGuard } from '@/features/GroupNotFound';

import { MobileGroupHeader } from './Header';

// Group init and id sync live one level up in the group scope layout
// (`MobileShell/GroupScopeLayout`), which the chat shares with the profile and
// permission pages.
export const MobileGroupLayout = () => (
  <MobileContentLayout header={<MobileGroupHeader />} style={{ overflowY: 'hidden' }}>
    <GroupNotFoundGuard>
      <Outlet />
    </GroupNotFoundGuard>
  </MobileContentLayout>
);
