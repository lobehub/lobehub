import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';

import HomePageTracker from '@/components/Analytics/HomePageTracker';
import HomeContent from '@/features/Home';
import { useHomeMinimalLayout } from '@/features/Home/CustomizeModal/useHomeCustomization';
import HomeNavHeader from '@/features/Home/HomeNavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';

const Home: FC = () => {
  // Auto margins are what center a flex item inside the scroll lane, and they
  // have to sit on the item itself — the dashboard never wants them.
  const minimal = useHomeMinimalLayout();

  return (
    <>
      <HomePageTracker />
      <HomeNavHeader />
      {/* The page scrolls here, at full pane width, rather than inside the
          centered column: it puts the scrollbar against the app frame instead
          of floating it in the margin beside the content, and a native
          overflow container takes no tab stop — a scroll viewport would, and
          its focus ring would trace a box around the entire dashboard. */}
      <Flexbox
        height={'100%'}
        style={{ overflowY: 'auto', paddingBlock: '32px 24px', paddingInline: 24 }}
        width={'100%'}
      >
        <WideScreenContainer
          fullWidth
          style={{ marginInline: 'auto', maxWidth: 1240 }}
          wrapperStyle={{ flex: 'none', marginBlock: minimal ? 'auto' : undefined }}
        >
          <HomeContent />
        </WideScreenContainer>
      </Flexbox>
    </>
  );
};

export default Home;
