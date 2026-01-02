import { useEffect, useState } from 'react';

import { isOnServerSide } from '@/utils/env';

import { SCROLL_PARENT_ID } from '../../features/const';

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
