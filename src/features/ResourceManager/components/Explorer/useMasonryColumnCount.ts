import { useLayoutEffect, useState } from 'react';

export const resolveMasonryColumnCount = (width: number) => {
  if (width < 768) return 2;
  if (width < 1024) return 3;
  if (width < 1536) return 4;
  return 5;
};

// Resolved synchronously on the first render: a default column count that is
// corrected in an effect re-lays out every masonry card one frame later.
export const useMasonryColumnCount = () => {
  const [columnCount, setColumnCount] = useState(() =>
    resolveMasonryColumnCount(typeof window === 'undefined' ? 1024 : window.innerWidth),
  );

  useLayoutEffect(() => {
    const updateColumnCount = () => setColumnCount(resolveMasonryColumnCount(window.innerWidth));

    updateColumnCount();
    window.addEventListener('resize', updateColumnCount);
    return () => window.removeEventListener('resize', updateColumnCount);
  }, []);

  return columnCount;
};
