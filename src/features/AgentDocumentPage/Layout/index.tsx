'use client';

import { Flexbox } from '@lobehub/ui';
import { Outlet } from 'react-router';

import AgentDocumentRightPanel from '../RightPanel';

const AgentDocumentLayout = () => (
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
    <AgentDocumentRightPanel />
  </Flexbox>
);

export default AgentDocumentLayout;
