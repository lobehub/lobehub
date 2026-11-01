import { useEffect, useState } from 'react';

import SkeletonList from '@/features/NavPanel/components/SkeletonList';

/**
 * The right panel's placeholder for a tab that has not mounted yet.
 *
 * It waits one frame budget before appearing: the Files tab paints its
 * replica-backed tree within that window, and an immediately rendered
 * skeleton would flash over the saved tree even though it is ready.
 */
const DeferredSkeleton = () => {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShow(true), 150);
    return () => clearTimeout(timer);
  }, []);

  if (!show) return null;
  return <SkeletonList paddingBlock={8} paddingInline={8} rows={6} />;
};

export default DeferredSkeleton;
