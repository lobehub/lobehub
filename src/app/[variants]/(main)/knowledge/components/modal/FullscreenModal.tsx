'use client';

import { Modal } from '@lobehub/ui';
import { ConfigProvider } from 'antd';
import { createStyles } from 'antd-style';
import { ReactNode, useCallback, useState } from 'react';

import { DETAIL_PANEL_WIDTH } from '../FileDetail';

const useStyles = createStyles(({ css, token }, showDetail: boolean) => {
  return {
    body: css`
      height: 100%;
      max-height: calc(100dvh - 56px) !important;
    `,
    content: css`
      height: 100%;
      border: none !important;
      background: transparent !important;
    `,
    extra: css`
      position: fixed;
      z-index: ${token.zIndexPopupBase + 10};
      inset-block: 0 0;
      inset-inline-end: 0;

      width: ${DETAIL_PANEL_WIDTH}px;
      border-inline-start: 1px solid ${token.colorSplit};

      background: ${token.colorBgLayout};
    `,
    header: css`
      background: transparent !important;
    `,
    modal: css`
      position: relative;
      inset-block-start: 0;

      width: ${showDetail ? `calc(100vw - ${DETAIL_PANEL_WIDTH}px) ` : '100vw'} !important;
      max-width: none;
      height: 100%;
      margin: 0;
      padding-block-end: 0;

      > div {
        height: 100%;
      }
    `,
  };
});

interface FullscreenModalProps {
  children: ReactNode;
  detail?: ReactNode;
  onClose?: () => void;
}

const FullscreenModal = ({ children, detail, onClose }: FullscreenModalProps) => {
  const [open, setOpen] = useState(true);

  const { styles } = useStyles(!!detail);

  const handleCancel = useCallback(() => {
    setOpen(false);
    onClose?.();
  }, [onClose]);

  return (
    <>
      <ConfigProvider theme={{ token: { motion: false } }}>
        <Modal
          className={styles.modal}
          classNames={{ body: styles.body, content: styles.content, header: styles.header }}
          footer={false}
          onCancel={handleCancel}
          open={open}
          width={'auto'}
        >
          {children}
        </Modal>
      </ConfigProvider>
      {!!detail && <div className={styles.extra}>{detail}</div>}
    </>
  );
};
export default FullscreenModal;
