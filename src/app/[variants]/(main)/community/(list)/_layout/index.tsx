import { Flexbox } from '@lobehub/ui';
import { Outlet } from 'react-router-dom';

import WideScreenContainer from '@/features/WideScreenContainer';

import { MAX_WIDTH } from '../../features/const';
import Footer from './Footer';
import Header from './Header';
import { styles } from './style';

const Layout = () => {
  return (
    <>
      <Header />
      <Flexbox className={styles.mainContainer} height={'100%'} width={'100%'}>
        <WideScreenContainer
          className={styles.contentContainer}
          gap={16}
          minWidth={MAX_WIDTH}
          paddingBlock={16}
          wrapperStyle={{
            minHeight: '100%',
            position: 'relative',
          }}
        >
          <Outlet />
          <div className={styles.spacer} />
          <Footer />
        </WideScreenContainer>
      </Flexbox>
    </>
  );
};

export default Layout;
