'use client';

import { ActionIcon, createStaticStyles, cssVar } from '@lobehub/ui';
import { MessageSquarePlus } from 'lucide-react';
import { memo } from 'react';

/** Marks the box the action floats over; hovering it reveals the action. */
export const FLOATING_ACTION_HOST = 'data-floating-action-host';

const styles = createStaticStyles(({ css }) => ({
  button: css`
    pointer-events: auto;

    position: sticky;
    inset-block-start: 12px;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 50%;

    opacity: 0;
    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowTertiary};

    transition: opacity ${cssVar.motionDurationMid};

    [${FLOATING_ACTION_HOST}]:hover &,
    &:focus-visible {
      opacity: 1;
    }

    /* No hover to reveal it with: a touch reader has to see it to use it. */
    @media (hover: none) {
      opacity: 1;
    }
  `,
  /**
   * Spans the whole picture so the button can stick to the top of the viewport
   * while a long screenshot scrolls past, and never leave the picture it
   * belongs to. It sits in the margin to the right of the picture, so it never
   * covers what is being commented on, and outside the comment pins that
   * straddle the right edge. Still a child of the host, so moving the pointer
   * onto it keeps it revealed.
   */
  rail: css`
    pointer-events: none;

    position: absolute;
    z-index: 5;
    inset-block: 0;
    inset-inline-end: -40px;

    /* A phone column has no margin to spare: tuck it inside the picture. */
    @media (width <= 767px) {
      inset-block: 8px;
      inset-inline-end: 8px;
    }
  `,
}));

/**
 * Comment on this picture without leaving it. The check's own comment and
 * annotate buttons sit under all of its evidence, so on a check with a few tall
 * screenshots the reviewer scrolled past everything they were looking at to
 * reach them — and then had to pick the picture again in the modal.
 *
 * Render inside a positioned box carrying {@link FLOATING_ACTION_HOST}.
 */
const FloatingCommentAction = memo<{ onClick: () => void; title: string }>(({ onClick, title }) => {
  return (
    <div className={styles.rail}>
      <ActionIcon
        className={styles.button}
        icon={MessageSquarePlus}
        size={'small'}
        title={title}
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
