import { Suspense } from 'react';

import SessionListContent from './SessionListContent';
import SkeletonList from './SkeletonList';

const Home = () => {
  return (
    <Suspense fallback={<SkeletonList />}>
      <SessionListContent />
    </Suspense>
  );
};

export default Home;
