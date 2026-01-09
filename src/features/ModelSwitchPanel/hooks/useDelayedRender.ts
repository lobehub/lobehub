import { useEffect, useState } from 'react';

import { RENDER_ALL_DELAY_MS } from '../const';

export const useDelayedRender = (isOpen: boolean) => {
  const [renderAll, setRenderAll] = useState(false);

  useEffect(() => {
    if (isOpen && !renderAll) {
      const timer = setTimeout(() => {
        setRenderAll(true);
      }, RENDER_ALL_DELAY_MS);
      return () => clearTimeout(timer);
    }
  }, [isOpen, renderAll]);

  return renderAll;
};
