import { ScrollArea } from '@lobehub/ui';
import { type FC, lazy, Suspense } from 'react';

import HomePageTracker from '@/components/Analytics/HomePageTracker';
import HomeContent from '@/features/Home';
import { useHomeMinimalLayout } from '@/features/Home/CustomizeModal/useHomeCustomization';
import HomeNavHeader from '@/features/Home/HomeNavHeader';
import HomeViewTabs from '@/features/Home/HomeViewTabs';
import { useHomeView } from '@/features/Home/useHomeView';
import WideScreenContainer from '@/features/WideScreenContainer';

// Keep in sync with NavHeader's height so the track starts at its bottom edge.
const HOME_NAV_HEADER_HEIGHT = 44;

const HomeTeamBoard = lazy(() => import('@/features/HomeTeamBoard'));

const Home: FC = () => {
  // Auto margins are what center a flex item inside the scroll lane, and they
  // have to sit on the item itself — the dashboard never wants them.
  const minimal = useHomeMinimalLayout();
  const { isWorkspace, setView, view } = useHomeView();
  const teamBoard = view === 'team';

  return (
    <>
      <HomePageTracker />
      <HomeNavHeader
        showControls={!teamBoard}
        tabs={isWorkspace ? <HomeViewTabs value={view} onChange={setView} /> : undefined}
      />
      <ScrollArea
        disableContentFit
        scrollFade
        scrollbarProps={{ style: { marginBlockStart: HOME_NAV_HEADER_HEIGHT } }}
        style={{ height: '100%', overflow: 'hidden', width: '100%' }}
        viewportProps={{ tabIndex: -1 }}
        contentProps={{
          style: {
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            minHeight: '100%',
            paddingBlock: '32px 24px',
            paddingInline: 24,
          },
        }}
      >
        <WideScreenContainer
          fullWidth
          style={{ marginInline: 'auto', maxWidth: 1240 }}
          wrapperStyle={{ flex: 'none', marginBlock: minimal && !teamBoard ? 'auto' : undefined }}
        >
          {/* CSS only: Activity tears down effects, which resets the composer's editor
              and loses a draft on a look at the board. */}
          <div style={{ display: teamBoard ? 'none' : undefined }}>
            <HomeContent />
          </div>
          {teamBoard && (
            <Suspense fallback={null}>
              <HomeTeamBoard />
            </Suspense>
          )}
        </WideScreenContainer>
      </ScrollArea>
    </>
  );
};

export default Home;
