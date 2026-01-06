import { useEffect, useState } from 'react';

/**
 * Hook to calculate responsive column count for masonry layout
 * @returns The current column count based on window width
 */
export const useMasonryColumnCount = () => {
  const [columnCount, setColumnCount] = useState(4);

  useEffect(() => {
    const updateColumnCount = () => {
      const width = window.innerWidth;
      if (width < 768) {
        setColumnCount(2);
      } else if (width < 1024) {
        setColumnCount(3);
      } else if (width < 1536) {
        setColumnCount(4);
      } else {
        setColumnCount(5);
      }
    };

    updateColumnCount();
    window.addEventListener('resize', updateColumnCount);
    return () => window.removeEventListener('resize', updateColumnCount);
  }, []);

  return columnCount;
};
