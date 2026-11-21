import { useCallback, useEffect, useState } from 'react';

const AUTO_EXPAND_DELAY = 100;

interface ToolExpandStateOptions {
  /** The manifest forbids collapsing this card. */
  isAlwaysExpand: boolean;
  /** The card should show its detail without a click (manifest default or pending intervention). */
  needExpand: boolean;
}

/**
 * Expand state of one tool card.
 *
 * A card that needs expanding at mount starts open, so a reloaded history card
 * renders expanded right away instead of flashing collapsed and animating open.
 * A card that only starts needing it later (e.g. an intervention turns pending)
 * still opens after a short delay.
 */
export const useToolExpandState = ({ isAlwaysExpand, needExpand }: ToolExpandStateOptions) => {
  const [showDebug, setShowDebug] = useState(false);
  const [showToolRender, setShowToolRender] = useState(needExpand);

  const handleExpand = useCallback(
    (expand?: boolean) => {
      // Block collapse action when alwaysExpand is set
      if (isAlwaysExpand && expand === false) return;
      // When collapsing, also turn off debug mode so the accordion can actually collapse
      if (expand === false) setShowDebug(false);
      setShowToolRender(!!expand);
    },
    [isAlwaysExpand],
  );

  useEffect(() => {
    if (!needExpand) return;
    const timer = setTimeout(() => setShowToolRender(true), AUTO_EXPAND_DELAY);
    return () => clearTimeout(timer);
  }, [needExpand]);

  return { handleExpand, setShowDebug, showDebug, showToolRender };
};
