import { memo,Suspense } from 'react';

import SessionListContent from './features/SessionListContent';
import SkeletonList from './features/SkeletonList';

const Home = memo(() => {
  return (
    <Suspense fallback={<SkeletonList />}>
      <SessionListContent />
    </Suspense>
  );
});

Home.displayName = 'MobileHome';

export default Home;
