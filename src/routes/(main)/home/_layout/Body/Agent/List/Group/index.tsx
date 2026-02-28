import { type SidebarGroup } from '@lobechat/types';
import { Accordion } from '@lobehub/ui';
import React, { memo } from 'react';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import Item from './Item';

interface GroupProps {
  dataSource: SidebarGroup[];
}

const Group = memo<GroupProps>(({ dataSource }) => {
  const [sessionGroupKeys, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.sessionGroupKeys(s),
    s.updateSystemStatus,
  ]);

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
