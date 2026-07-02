import { type SidebarGroup } from '@lobechat/types';
import { Accordion } from '@lobehub/ui';
import React, { memo } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import Item from './Item';

interface GroupProps {
  dataSource: SidebarGroup[];
}

const Group = memo<GroupProps>(({ dataSource }) => {
  const activeWorkspaceId = useActiveWorkspaceId();
  const sessionGroupKeys = useGlobalStore(
    systemStatusSelectors.sessionGroupKeys(activeWorkspaceId),
  );
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  return (
    <Accordion
      expandedKeys={sessionGroupKeys}
      onExpandedChange={(keys) => updateSystemStatus({ expandSessionGroupKeys: keys as any })}
    >
      {dataSource.map((item) => (
        <Item {...item} key={item.id} />
      ))}
    </Accordion>
  );
});

export default Group;
