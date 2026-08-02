import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';

import HomePageTracker from '@/components/Analytics/HomePageTracker';
import HomeContent from '@/features/Home';
import HomeNavHeader from '@/features/Home/HomeNavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';

const Home: FC = () => {
  return (
    <>
      <HomePageTracker />
      <HomeNavHeader />
      <Flexbox
        height={'100%'}
        style={{ overflow: 'hidden', paddingBlockStart: 32, paddingInline: 24 }}
        width={'100%'}
      >
        <WideScreenContainer
          fullWidth
          style={{ marginInline: 'auto', maxWidth: 1240, minHeight: 0 }}
          wrapperStyle={{ flex: 1, minHeight: 0 }}
        >
          <HomeContent />
        </WideScreenContainer>
      </Flexbox>
    </>
  );
};

export default Home;
