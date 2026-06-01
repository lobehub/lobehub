import { Flexbox } from '@lobehub/ui';
import { Outlet } from 'react-router-dom';

const Layout = () => {
  return (
    <Flexbox gap={24} width={'100%'}>
      <Outlet />
    </Flexbox>
  );
};

export default Layout;
