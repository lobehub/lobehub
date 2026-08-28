import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

export const useIntentionalHover = <T extends HTMLElement>(targetRef: RefObject<T | null>) => {
  const hoverArmedRef = useRef(false);
  const [isHoverExpanded, setIsHoverExpanded] = useState(false);

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      const target = targetRef.current;
      if (!target) return;

      hoverArmedRef.current = !target.matches(':hover');
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [targetRef]);

  const handlePointerEnter = useCallback((pointerType: string) => {
    if (pointerType !== 'touch' && hoverArmedRef.current) {
      setIsHoverExpanded(true);
    }
  }, []);

  const handlePointerLeave = useCallback(
    (pointerType: string) => {
      if (pointerType === 'touch') return;
      if (targetRef.current?.matches(':hover')) return;

      hoverArmedRef.current = true;
      setIsHoverExpanded(false);
    },
    [targetRef],
  );

  return {
    handlePointerEnter,
    handlePointerLeave,
    isHoverExpanded,
  };
};
