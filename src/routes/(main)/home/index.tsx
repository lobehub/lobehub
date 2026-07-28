import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';

import HomePageTracker from '@/components/Analytics/HomePageTracker';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';

import HomeContent from './features';

const Home: FC = () => {
  return (
    <>
      <HomePageTracker />
      <NavHeader />
      <Flexbox
        height={'100%'}
        style={{ overflowY: 'auto', paddingBlock: '32px 12vh', paddingInline: 24 }}
        width={'100%'}
      >
        <WideScreenContainer fullWidth style={{ marginInline: 'auto', maxWidth: 1240 }}>
          <HomeContent />
        </WideScreenContainer>
      </Flexbox>
    </>
  );
};

export default Home;
