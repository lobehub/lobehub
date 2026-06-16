'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { Outlet } from 'react-router-dom';

import AgentDocumentRightPanel from '../RightPanel';

const AgentDocumentLayout = memo(() => (
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
));

AgentDocumentLayout.displayName = 'AgentDocumentLayout';

export default AgentDocumentLayout;
