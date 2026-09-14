import { createStaticStyles, cx } from 'antd-style';

import { frostedModalStyles } from './modals';

export const CHECK_REJECT_MODAL_SIZE = { height: '98dvh', width: '98vw' } as const;
export const TEXT_REJECT_MODAL_WIDTH = 'min(560px, calc(100vw - 32px))';

/**
 * The modal chrome, not its contents. These classes ride on the popup element
 * that `createModal` owns, so they stay media-query driven: the shell has to
 * answer for both breakpoints in one node, unlike the body, which mounts one
 * presentation or the other.
 */
const styles = createStaticStyles(({ css }) => ({
  mobileClose: css`
    @media (width <= 767px) {
      inset-block-start: max(4px, env(safe-area-inset-top));
      inset-inline-end: 4px;
      width: 44px;
      height: 44px;
    }
  `,
  mobileContent: css`
    @media (width <= 767px) {
      padding-block: 0 max(12px, env(safe-area-inset-bottom));
      padding-inline: 12px;
    }
  `,
  mobileHeader: css`
    @media (width <= 767px) {
      min-height: 56px;
      padding-block: max(12px, env(safe-area-inset-top)) 12px;
      padding-inline: 12px 52px;
    }
  `,
  mobilePopup: css`
    @media (width <= 767px) {
      max-width: 100vw !important;

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
      close: styles.mobileClose,
      content: styles.mobileContent,
      header: styles.mobileHeader,
      popup: cx(styles.modalPopup, styles.mobilePopup, evidenceCount > 0 && styles.modalPopupMedia),
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
