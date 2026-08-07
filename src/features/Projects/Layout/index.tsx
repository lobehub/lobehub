'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { Outlet } from 'react-router';

import ProjectSidebar from './Sidebar';

const ProjectLayout = memo(() => (
  <>
    <ProjectSidebar />
    <Flexbox flex={1} height="100%" style={{ minWidth: 0 }}>
      <Outlet />
    </Flexbox>
  </>
));

ProjectLayout.displayName = 'ProjectLayout';

export default ProjectLayout;
