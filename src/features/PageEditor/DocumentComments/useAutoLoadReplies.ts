import { useCallback, useEffect, useState } from 'react';

export const useAutoLoadReplies = (enabled: boolean) => {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const containerRef = useCallback((node: HTMLDivElement | null) => setContainer(node), []);

  useEffect(() => {
    if (!enabled || shouldLoad || !container) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some(({ isIntersecting }) => isIntersecting)) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: '300px 0px' },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [container, enabled, shouldLoad]);

  return { containerRef, shouldLoad };
};
