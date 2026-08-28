import { Flexbox, Popover } from '@lobehub/ui';
import { type PropsWithChildren } from 'react';
import React, { memo, Suspense } from 'react';

import List from '@/features/HomeSidebar/Body/Agent/List';
import { AgentModalProvider } from '@/features/HomeSidebar/Body/Agent/ModalProvider';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

const SwitchPanel = memo<PropsWithChildren>(({ children }) => {
  const navigate = useWorkspaceAwareNavigate();
  return (
    <Popover
      placement="bottomLeft"
      trigger="click"
      content={
        <Suspense fallback={<SkeletonList rows={6} />}>
          <AgentModalProvider>
            <Flexbox
              gap={4}
              padding={8}
              style={{
                maxHeight: '50vh',
                overflowY: 'auto',
              }}
            >
              <List onMoreClick={() => navigate('/')} />
            </Flexbox>
          </AgentModalProvider>
        </Suspense>
      }
      styles={{
        content: {
          padding: 0,
          width: 240,
        },
      }}
    >
      {children}
    </Popover>
  );
});

export default SwitchPanel;
