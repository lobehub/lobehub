'use client';

import { ActionIcon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { MessageSquarePlus } from 'lucide-react';
import { memo } from 'react';

import { floatingActionHostMarker } from '../markers.stylex';

const compact = '@media (width <= 767px)';

const styles = stylex.create({
  button: {
    pointerEvents: 'auto',
    position: 'sticky',
    insetBlockStart: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '50%',
    // Revealed by hovering the host box (a marker, see markers.stylex.ts), or
    // on focus. With no hover to reveal it, a touch reader has to see it to use it.
    opacity: {
      'default': 0,
      ':focus-visible': 1,
      '@media (hover: none)': 1,
      [stylex.when.ancestor(':hover', floatingActionHostMarker)]: 1,
    },
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    boxShadow: cssVar.boxShadowTertiary,
    transition: `opacity ${cssVar.motionDurationMid}`,
  },
  // Spans the whole picture so the button can stick to the top of the viewport
  // while a long screenshot scrolls past, and never leave the picture it
  // belongs to. It sits in the margin to the right of the picture, so it never
  // covers what is being commented on, and outside the comment pins that
  // straddle the right edge. Still a child of the host, so moving the pointer
  // onto it keeps it revealed.
  rail: {
    pointerEvents: 'none',
    position: 'absolute',
    zIndex: 5,
    // A phone column has no margin to spare: tuck it inside the picture.
    insetBlockStart: { default: 0, [compact]: '8px' },
    insetBlockEnd: { default: 0, [compact]: '8px' },
    insetInlineEnd: { default: '-40px', [compact]: '8px' },
  },
});

/**
 * Comment on this picture without leaving it. The check's own comment and
 * annotate buttons sit under all of its evidence, so on a check with a few tall
 * screenshots the reviewer scrolled past everything they were looking at to
 * reach them — and then had to pick the picture again in the modal.
 *
 * Render inside a positioned box carrying {@link floatingActionHostMarker}.
 */
const FloatingCommentAction = memo<{ onClick: () => void; title: string }>(({ onClick, title }) => {
  return (
    <div {...stylex.props(styles.rail)}>
      <ActionIcon
        aria-label={title}
        icon={MessageSquarePlus}
        size={'small'}
        title={title}
        {...stylex.props(styles.button)}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
      />
    </div>
  );
});

FloatingCommentAction.displayName = 'AcceptanceFloatingCommentAction';

export default FloatingCommentAction;
