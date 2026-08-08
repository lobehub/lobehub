import { memo, Suspense } from 'react';

import SessionListContent from './SessionListContent';
import SkeletonList from './SkeletonList';

const Home = memo(() => {
  return (
    <Suspense fallback={<SkeletonList />}>
      <SessionListContent />
    </Suspense>
  );
});

Home.displayName = 'MobileHome';

export default Home;
