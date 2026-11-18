import { useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { memo, type ReactNode } from 'react';

/** The gap between attachments, which a leaving attachment gives back as its width collapses. */
export const CONTEXT_ITEM_GAP = 8;

const ENTER = { duration: 0.16, ease: [0.2, 0, 0, 1] as const };
const EXIT = { duration: 0.16, ease: [0.3, 0, 1, 1] as const };

/**
 * One attachment in the composer: it fades in from slightly smaller when attached, and when
 * removed fades out while its width and trailing gap collapse, so the attachments after it
 * slide into its place instead of jumping. Attachments present when the composer mounts (a
 * restored draft) appear without motion, through `AnimatePresence initial={false}`.
 */
const ContextMotionItem = memo<{ children: ReactNode }>(({ children }) => {
  const reduceMotion = useReducedMotion();

  return (
    <m.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{
        opacity: 1,
        scale: 1,
        transition: reduceMotion ? { duration: 0 } : ENTER,
      }}
      // A removed attachment gives back its width so the ones after it slide over; a
      // transform alone would leave its space empty and then jump.
      exit={{
        marginInlineEnd: -CONTEXT_ITEM_GAP,
        opacity: 0,
        // Set at once rather than animated: the leaving item takes no clicks and its content
        // does not spill over the attachments sliding into its place.
        overflow: 'hidden',
        pointerEvents: 'none',
        scale: 0.92,
        transition: reduceMotion ? { duration: 0 } : EXIT,
        width: 0,
      }}
    >
      {children}
    </m.div>
  );
});

ContextMotionItem.displayName = 'ContextMotionItem';

export default ContextMotionItem;
