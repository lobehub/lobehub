import * as stylex from '@stylexjs/stylex';

import { frostedModalStyles } from './modals';
import moduleStyles from './rejectModalShell.module.css';

export const CHECK_REJECT_MODAL_SIZE = { height: '98dvh', width: '98vw' } as const;
export const TEXT_REJECT_MODAL_WIDTH = 'min(560px, calc(100vw - 32px))';

// The module CSS repeats CHECK_REJECT_MODAL_SIZE (98vw x 98dvh) in `.modalPopupMedia`.
const phone = '@media (width <= 767px)';

/**
 * The modal chrome, not its contents. These classes ride on the popup element
 * that `createModal` owns, so they stay media-query driven: the shell has to
 * answer for both breakpoints in one node, unlike the body, which mounts one
 * presentation or the other.
 */
const styles = stylex.create({
  mobileClose: {
    insetBlockStart: { default: null, [phone]: 'max(4px, env(safe-area-inset-top))' },
    insetInlineEnd: { default: null, [phone]: '4px' },
    width: { default: null, [phone]: '44px' },
    height: { default: null, [phone]: '44px' },
  },
  mobileContent: {
    paddingBlockStart: { default: null, [phone]: 0 },
    paddingBlockEnd: { default: null, [phone]: 'max(12px, env(safe-area-inset-bottom))' },
    paddingInline: { default: null, [phone]: '12px' },
  },
  mobileHeader: {
    minHeight: { default: null, [phone]: '56px' },
    paddingBlockStart: { default: null, [phone]: 'max(12px, env(safe-area-inset-top))' },
    paddingBlockEnd: { default: null, [phone]: '12px' },
    paddingInlineStart: { default: null, [phone]: '12px' },
    paddingInlineEnd: { default: null, [phone]: '52px' },
  },
});

/** Evidence earns a near-fullscreen stage; a text-only reject stays a dialog. */
export const checkRejectModalSize = (evidenceCount: number) =>
  evidenceCount > 0
    ? CHECK_REJECT_MODAL_SIZE
    : ({ height: 'auto', width: TEXT_REJECT_MODAL_WIDTH } as const);

export const checkRejectModalShell = (evidenceCount: number) => {
  const modalSize = checkRejectModalSize(evidenceCount);
  return {
    classNames: {
      close: stylex.props(styles.mobileClose).className,
      content: stylex.props(styles.mobileContent).className,
      header: stylex.props(styles.mobileHeader).className,
      popup: [
        moduleStyles.modalPopup,
        moduleStyles.mobilePopup,
        evidenceCount > 0 && moduleStyles.modalPopupMedia,
      ]
        .filter(Boolean)
        .join(' '),
    },
    styles: {
      ...frostedModalStyles,
      content: { display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' },
    },
    width: modalSize.width,
  };
};

export const rejectModalTitle = (title: string, description?: string) => ({
  description: description?.trim() || undefined,
  title,
});

export const canDismissRejectModal = (loading: boolean) => !loading;
