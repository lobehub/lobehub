'use client';

import { Flexbox } from '@lobehub/ui';
import { Outlet } from 'react-router';

import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';

import AgentDocumentSidebarContent from '../RightPanel';

const AgentDocumentLayout = () => (
  <>
    <NavPanelPortal navKey="agent-docs">
      <AgentDocumentSidebarContent />
    </NavPanelPortal>
    <Flexbox
      horizontal
      flex={1}
      height={'100%'}
      style={{ minHeight: 0, overflow: 'hidden', position: 'relative' }}
      width={'100%'}
    >
      <Flexbox flex={1} style={{ minHeight: 0, minWidth: 0 }}>
        <Outlet />
      </Flexbox>
    </Flexbox>
  </>
);

export default AgentDocumentLayout;
