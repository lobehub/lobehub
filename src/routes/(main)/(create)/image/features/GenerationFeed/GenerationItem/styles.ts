import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { generationItemMarker } from '../markers.stylex';

const shimmer = stylex.keyframes({
  '0%': { opacity: 1 },
  '50%': { opacity: 0 },
  '100%': { opacity: 1 },
});

const rules = stylex.create({
  // Common styles for image action buttons; revealed while the item is hovered.
  generationActionButton: {
    position: 'absolute',
    zIndex: 10,
    insetBlockStart: '8px',
    insetInlineEnd: '8px',
    opacity: { default: 0, [stylex.when.ancestor(':hover', generationItemMarker)]: 1 },
    transition: `opacity 0.1s ${cssVar.motionEaseInOut}`,
  },
  imageContainer: { position: 'relative', overflow: 'hidden', width: '100%' },
  placeholderContainer: { position: 'relative', overflow: 'hidden', width: '100%' },
  placeholderContainerLoading: {
    '::before': {
      content: '""',
      position: 'absolute',
      zIndex: 1,
      inset: 0,
      backgroundColor: cssVar.colorFillSecondary,
      backgroundImage: 'none',
      animationName: shimmer,
      animationDuration: '2s',
      animationTimingFunction: 'linear',
      animationIterationCount: 'infinite',
    },
  },
  spinIcon: { color: cssVar.colorPrimary },
});

/** Class names, so the Block / ActionIconGroup call sites keep passing `className`. */
export const styles = {
  generationActionButton: stylex.props(rules.generationActionButton).className!,
  imageContainer: stylex.props(generationItemMarker, rules.imageContainer).className!,
  placeholderContainer: stylex.props(generationItemMarker, rules.placeholderContainer).className!,
  placeholderContainerLoading: stylex.props(rules.placeholderContainerLoading).className!,
  spinIcon: stylex.props(rules.spinIcon).className!,
};
