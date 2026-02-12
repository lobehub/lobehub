'use client';

import { Modal } from '@lobehub/ui';
import { ConfigProvider } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import { type ReactNode } from 'react';
import { useCallback, useState } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
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
    z-index: ${cssVar.zIndexPopupBase + 10};
    inset-block: 0;
    inset-inline-end: 0;

    width: 0;
    border-inline-start: 1px solid ${cssVar.colorSplit};

    background: ${cssVar.colorBgLayout};
  `,
  header: css`
    background: transparent !important;
  `,
  modal: css`
    position: relative;
    inset-block-start: 0;

    width: 100vw !important;
    max-width: none;
    height: 100%;
    margin: 0;
    padding-block-end: 0;

    > div {
      height: 100%;
    }
  `,
  modal_withDetail: css`
    width: calc(100vw) !important;
  `,
}));

interface FullscreenModalProps {
  children: ReactNode;
  detail?: ReactNode;
  onClose?: () => void;
}

const FullscreenModal = ({ children, detail, onClose }: FullscreenModalProps) => {
  const [open, setOpen] = useState(true);
  const showDetail = !!detail;

  const handleCancel = useCallback(() => {
    setOpen(false);
    onClose?.();
  }, [onClose]);

  return (
    <>
      <ConfigProvider theme={{ token: { motion: false } }}>
        <Modal
          className={cx(styles.modal, showDetail && styles.modal_withDetail)}
          classNames={{ body: styles.body, header: styles.header, wrapper: styles.content }}
          footer={false}
          open={open}
          width={'auto'}
          onCancel={handleCancel}
        >
          {children}
        </Modal>
      </ConfigProvider>
      {!!detail && <div className={styles.extra}>{detail}</div>}
    </>
  );
};
export default FullscreenModal;
