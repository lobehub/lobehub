import { useEffect, useState } from 'react';

import { isOnServerSide } from '@/utils/env';

export const SCROLL_PARENT_ID = 'memory-scroll';

export const useScrollParent = () => {
  const [parent, setParent] = useState<HTMLDivElement>();

  useEffect(() => {
    if (isOnServerSide) return;
    const scrollParent = document.querySelector(`#${SCROLL_PARENT_ID}`);
    if (scrollParent) {
      setParent(scrollParent as HTMLDivElement);
    }
  }, []);

  return parent;
};
