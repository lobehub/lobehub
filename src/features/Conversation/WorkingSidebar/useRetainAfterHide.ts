import { useEffect, useState } from 'react';

/**
 * Returns `true` while `visible`, and for `delay` ms after it turns `false`.
 * Lets a hidden subtree stay mounted for a quick reopen, then release its DOM
 * when it stays hidden.
 */
export const useRetainAfterHide = (visible: boolean, delay: number): boolean => {
  const [retained, setRetained] = useState(visible);

  useEffect(() => {
    if (visible) {
      setRetained(true);
      return;
    }
    const timer = setTimeout(() => setRetained(false), delay);
    return () => clearTimeout(timer);
  }, [visible, delay]);

  return visible || retained;
};
