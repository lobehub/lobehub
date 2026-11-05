// oxlint-disable-next-line stylex-migration/no-emotion-styles -- needs lobe-ui slot: createModal panel
import { createStaticStyles, cx } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

import { frostedModalStyles } from './modals';

export const CHECK_REJECT_MODAL_SIZE = { height: '98dvh', width: '98vw' } as const;
export const TEXT_REJECT_MODAL_WIDTH = 'min(560px, calc(100vw - 32px))';

const phone = '@media (width <= 767px)';

/**
 * The modal chrome, not its contents. These classes ride on the popup element
 * that `createModal` owns, so they stay media-query driven: the shell has to
 * answer for both breakpoints in one node, unlike the body, which mounts one
 * presentation or the other.
 */
const styles = stylex.create({
  mobilePopup: {
    maxWidth: { default: null, [phone]: '100vw' },
  },
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

const fallback = createStaticStyles(({ css }) => ({
  mobilePopup: css`
    @media (width <= 767px) {
      > div {
        width: 100vw;
        max-width: 100vw;
        height: 100dvh;
        max-height: 100dvh;
        padding: 0;
        border-radius: 0;
      }
    }
  `,
  modalPopup: css`
    > div {
      display: flex;
      flex-direction: column;
    }
  `,
  modalPopupMedia: css`
    > div {
      width: ${CHECK_REJECT_MODAL_SIZE.width};
      max-width: ${CHECK_REJECT_MODAL_SIZE.width};
      height: ${CHECK_REJECT_MODAL_SIZE.height};

      @media (width <= 767px) {
        width: 100vw;
        max-width: 100vw;
        height: 100dvh;
        max-height: 100dvh;
        padding: 0;
        border-radius: 0;
      }
    }
  `,
}));

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
      popup: cx(
        stylex.props(styles.mobilePopup).className,
        fallback.modalPopup,
        fallback.mobilePopup,
        evidenceCount > 0 && fallback.modalPopupMedia,
      ),
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
