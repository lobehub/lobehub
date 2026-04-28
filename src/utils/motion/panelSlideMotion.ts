/** Slide direction for panel content swap: -1 = back, 0 = none, 1 = forward */
export type PanelSlideMotionDirection = -1 | 0 | 1;

const OFFSET_PX = 8;

const transition = {
  duration: 0.28,
  ease: [0.4, 0, 0.2, 1],
} as const;

function createPanelSlideMotionVariants(horizontalSign: 1 | -1) {
  return {
    animate: { opacity: 1, x: 0 },
    exit: (direction: PanelSlideMotionDirection) => ({
      opacity: 0,
      x: -direction * OFFSET_PX * horizontalSign,
    }),
    initial: (direction: PanelSlideMotionDirection) => ({
      opacity: 0,
      x: direction * OFFSET_PX * horizontalSign,
    }),
    transition,
  } as const;
}

/**
 * Left-docked panel (e.g. main nav): forward / back along the natural reading axis of that strip.
 */
export const panelSlideMotionVariantsLeft = createPanelSlideMotionVariants(1);

/**
 * Right-docked panel (e.g. page editor side panel): same timing as left, horizontal slide mirrored.
 */
export const panelSlideMotionVariantsRight = createPanelSlideMotionVariants(-1);

export const isPanelLayerMotionDisabled = (animationMode?: string) => animationMode === 'disabled';
