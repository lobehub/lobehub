'use client';

import DesktopHome from '@/routes/(main)/home';
import DesktopHomeLayout from '@/routes/(main)/home/_layout';

const DesktopHomeRoute = () => (
  <DesktopHomeLayout>
    <DesktopHome />
  </DesktopHomeLayout>
);

export default DesktopHomeRoute;
