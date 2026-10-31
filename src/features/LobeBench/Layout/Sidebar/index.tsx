'use client';

import { memo } from 'react';

import Content from '@/features/LobeBench/Layout/Sidebar/Content';
import NavPanelPortal from '@/features/NavPanel/NavPanelPortal';

const Sidebar = memo(() => (
  <NavPanelPortal navKey="eval">
    <Content />
  </NavPanelPortal>
));

export default Sidebar;
