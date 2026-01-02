import { Flexbox } from '@lobehub/ui';
import { Outlet } from 'react-router-dom';

import CategoryContainer from '../../../components/CategoryContainer';
import Category from '../features/Category';
import { styles } from './style';

const Layout = () => {
  return (
    <Flexbox className={styles.mainContainer} gap={24} horizontal width={'100%'}>
      <CategoryContainer>
        <Category />
      </CategoryContainer>
      <Flexbox flex={1} gap={16}>
        <Outlet />
      </Flexbox>
    </Flexbox>
  );
};

Layout.displayName = 'DesktopDiscoverToolsLayout';

export default Layout;
