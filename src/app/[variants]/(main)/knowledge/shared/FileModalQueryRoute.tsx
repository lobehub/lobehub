'use client';

import { Modal } from '@lobehub/ui';
import { ConfigProvider } from 'antd';
import { createStyles } from 'antd-style';
import { memo, useCallback, useMemo } from 'react';

import { fileManagerSelectors, useFileStore } from '@/store/file';

import { DETAIL_PANEL_WIDTH } from '../components/FileDetail';
import FileDetail from '../components/modal/FileDetail';
import FilePreview from '../components/modal/FilePreview';
import { useFileModalId, useSetFileModalId } from './useFileQueryParam';

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

/**
 * FileModalQueryRoute component for Knowledge routes
 * Renders the file preview modal when a 'file' query parameter is present
 * Example: ?file=file_123
 * File data is fetched from the Zustand store by FilePreview and FileDetail components
 */
const FileModalQueryRoute = memo(() => {
  const fileId = useFileModalId();
  const setFileModalId = useSetFileModalId();
  const file = useFileStore(fileManagerSelectors.getFileById(fileId));
  const showDetail = useMemo(() => Boolean(fileId && file), [fileId, file]);
  const { styles } = useStyles(showDetail);

  const handleClose = useCallback(() => {
    setFileModalId(undefined);
  }, [setFileModalId]);

  if (!showDetail || !fileId) return null;

  return (
    <>
      <ConfigProvider theme={{ token: { motion: false } }}>
        <Modal
          className={styles.modal}
          classNames={{ body: styles.body, content: styles.content, header: styles.header }}
          footer={false}
          onCancel={handleClose}
          open={showDetail}
          width={'auto'}
        >
          <FilePreview id={fileId} />
        </Modal>
      </ConfigProvider>
      <div className={styles.extra}>
        <FileDetail id={fileId} />
      </div>
    </>
  );
});

FileModalQueryRoute.displayName = 'FileModalQueryRoute';

export default FileModalQueryRoute;
