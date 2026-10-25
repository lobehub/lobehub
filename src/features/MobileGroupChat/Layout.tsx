import { Outlet } from 'react-router';

import MobileContentLayout from '@/components/server/MobileNavLayout';
import { GroupNotFoundGuard } from '@/features/GroupNotFound';
import { useInitGroupConfig } from '@/hooks/useInitGroupConfig';
import GroupIdSync from '@/routes/(main)/group/_layout/GroupIdSync';

import { MobileGroupHeader } from './Header';

export const MobileGroupLayout = () => {
  useInitGroupConfig();

  return (
    <>
      <MobileContentLayout header={<MobileGroupHeader />} style={{ overflowY: 'hidden' }}>
        <GroupNotFoundGuard>
          <Outlet />
        </GroupNotFoundGuard>
      </MobileContentLayout>
      <GroupIdSync />
    </>
  );
};
