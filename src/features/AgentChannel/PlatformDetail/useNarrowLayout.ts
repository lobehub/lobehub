import { useEffect, useState } from 'react';

/** Below this width the page has no room for the chat preview beside the form. */
const NARROW_QUERY = '(max-width: 1100px)';

/** Whether the window is too narrow for the split layout. */
export const useNarrowLayout = () => {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.(NARROW_QUERY).matches,
  );

  useEffect(() => {
    const query = window.matchMedia?.(NARROW_QUERY);
    if (!query) return;
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return narrow;
};
