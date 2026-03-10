'use client';

import { LoadingOutlined } from '@ant-design/icons';
import { Button, Flexbox } from '@lobehub/ui';
import { Input, Modal, Spin } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronLeft, ChevronRight, Expand, FileText } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';
import { Document, Page } from '@/libs/pdfjs';

import { containerStyles } from '../style';

const styles = createStaticStyles(({ css }) => ({
  containerWrapper: css`
    position: relative;
    width: 100%;
    height: 100%;
  `,
  documentLoading: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;

    height: 100%;
    padding: 20px;
  `,
  emptyState: css`
    display: flex;
    align-items: center;
    justify-content: center;

    height: 100%;

    color: #666;
  `,
  expandButton: css`
    position: absolute;
    z-index: 1000;
    inset-block-start: 20px;
    inset-inline-end: 20px;
  `,
  footerNavigation: css`
    position: absolute;
    z-index: 10;
    inset-block-end: 0;
    inset-inline: 0;

    padding: 12px;
    border-block-start: 1px solid color-mix(in srgb, black 10%, transparent);

    background: color-mix(in srgb, white 90%, transparent);
    backdrop-filter: blur(8px);
  `,
  fullscreenButton: css`
    border-color: white;
    color: white;
  `,
  fullscreenContent: css`
    display: flex;
    align-items: flex-start;
    justify-content: center;

    min-height: 100%;
    padding: 20px;
  `,
  fullscreenModal: css`
    position: relative;
    overflow: auto;
    height: 90vh;
  `,
  fullscreenNavigation: css`
    position: fixed;
    z-index: 1001;
    inset-block-end: 20px;
    inset-inline-start: 50%;
    transform: translateX(-50%);

    padding-block: 12px;
    padding-inline: 20px;
    border-radius: 8px;

    background: color-mix(in srgb, black 70%, transparent);
    backdrop-filter: blur(8px);
  `,
  fullscreenPageInput: css`
    width: 60px;
    text-align: center;
  `,
  fullscreenPageText: css`
    min-width: 20px;
    font-size: 14px;
    color: white;
  `,
  loadingState: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;

    height: 100%;
  `,
  loadingText: css`
    margin-block-start: 8px;
    color: #666;
  `,
  pageInput: css`
    width: 50px;
    text-align: center;
  `,
  pageNumberText: css`
    font-size: 12px;
    color: #666;
  `,
  previewContainer: css`
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 12px;
  `,
}));

interface PdfPreviewProps {
  loading: boolean;
  onGeneratePdf?: () => void;
  pdfData: string | null;
}

const PdfPreview = memo<PdfPreviewProps>(({ loading, pdfData, onGeneratePdf }) => {
  const localStyles = styles;
  const { t } = useTranslation('chat');
  const isMobile = useIsMobile();

  // Page navigation state
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [fullscreenPageNumber, setFullscreenPageNumber] = useState<number>(1);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setPageNumber(1);
  };

  const goToPrevPage = () => {
    if (pageNumber > 1) {
      setPageNumber(pageNumber - 1);
    }
  };

  const goToNextPage = () => {
    if (pageNumber < numPages) {
      setPageNumber(pageNumber + 1);
    }
  };

  const goToPage = (page: number) => {
    if (page >= 1 && page <= numPages) {
      setPageNumber(page);
    }
  };

  const handleFullscreen = () => {
    if (pdfData) {
      setFullscreenPageNumber(pageNumber);
      setFullscreenOpen(true);
    }
  };

  const goToFullscreenPrevPage = () => {
    if (fullscreenPageNumber > 1) {
      setFullscreenPageNumber(fullscreenPageNumber - 1);
    }
  };

  const goToFullscreenNextPage = () => {
    if (fullscreenPageNumber < numPages) {
      setFullscreenPageNumber(fullscreenPageNumber + 1);
    }
  };

  const goToFullscreenPage = (page: number) => {
    if (page >= 1 && page <= numPages) {
      setFullscreenPageNumber(page);
    }
  };

  if (loading) {
    return (
      <div
        className={cx(containerStyles.preview, containerStyles.previewWide)}
        style={{ padding: 12 }}
      >
        <div className={localStyles.loadingState}>
          <Spin indicator={<LoadingOutlined spin style={{ fontSize: 24 }} />} />
          <div className={localStyles.loadingText}>{t('shareModal.generatingPdf')}</div>
        </div>
      </div>
    );
  }

  if (!pdfData) {
    return (
      <div
        className={cx(containerStyles.preview, containerStyles.previewWide)}
        style={{ padding: 12 }}
      >
        <div className={localStyles.emptyState}>
          <Button icon={<FileText size={20} />} size="large" type="primary" onClick={onGeneratePdf}>
            {t('shareModal.generatePdf')}
          </Button>
        </div>
      </div>
    );
  }

  // Convert base64 to data URI
  const pdfDataUri = `data:application/pdf;base64,${pdfData}`;

  return (
    <>
      <div className={localStyles.containerWrapper}>
        {pdfData && (
          <Button
            className={localStyles.expandButton}
            icon={<Expand size={16} />}
            size="small"
            type="text"
            onClick={handleFullscreen}
          />
        )}

        <div
          className={cx(
            containerStyles.preview,
            containerStyles.previewWide,
            localStyles.previewContainer,
          )}
        >
          <Document
            file={pdfDataUri}
            loading={
              <div className={localStyles.documentLoading}>
                <Spin />
                <div className={localStyles.loadingText}>{t('shareModal.loadingPdf')}</div>
              </div>
            }
            onLoadSuccess={onDocumentLoadSuccess}
          >
            <Page
              pageNumber={pageNumber}
              renderAnnotationLayer={false}
              renderTextLayer={false}
              width={isMobile ? 300 : 400}
            />
          </Document>
        </div>

        {/* 页脚导航 */}
        {pdfData && numPages > 1 && (
          <div className={localStyles.footerNavigation}>
            <Flexbox horizontal align="center" gap={8} justify="center">
              <Button
                disabled={pageNumber <= 1}
                icon={<ChevronLeft size={16} />}
                size="small"
                type="text"
                onClick={goToPrevPage}
              />
              <Flexbox horizontal align="center" gap={4}>
                <Input
                  className={localStyles.pageInput}
                  max={numPages}
                  min={1}
                  size="small"
                  type="number"
                  value={pageNumber}
                  onChange={(e) => {
                    const value = parseInt(e.target.value);
                    if (!isNaN(value)) goToPage(value);
                  }}
                />
                <span className={localStyles.pageNumberText}>/ {numPages}</span>
              </Flexbox>
              <Button
                disabled={pageNumber >= numPages}
                icon={<ChevronRight size={16} />}
                size="small"
                type="text"
                onClick={goToNextPage}
              />
            </Flexbox>
          </div>
        )}
      </div>

      {/* 全屏模态框 */}
      <Modal
        centered
        footer={null}
        open={fullscreenOpen}
        width="95vw"
        styles={{
          body: { padding: 0 },
        }}
        onCancel={() => setFullscreenOpen(false)}
      >
        <div className={localStyles.fullscreenModal}>
          <div className={localStyles.fullscreenContent}>
            <Document file={pdfDataUri} onLoadSuccess={onDocumentLoadSuccess}>
              <Page
                pageNumber={fullscreenPageNumber}
                renderAnnotationLayer={false}
                renderTextLayer={false}
                width={Math.min(window.innerWidth * 0.8, 1000)}
              />
            </Document>
          </div>

          {/* 全屏模式下的导航 */}
          {numPages > 1 && (
            <div className={localStyles.fullscreenNavigation}>
              <Flexbox horizontal align="center" gap={12}>
                <Button
                  className={localStyles.fullscreenButton}
                  disabled={fullscreenPageNumber <= 1}
                  icon={<ChevronLeft size={16} />}
                  size="small"
                  type="text"
                  onClick={goToFullscreenPrevPage}
                />
                <Flexbox horizontal align="center" gap={8}>
                  <Input
                    className={localStyles.fullscreenPageInput}
                    max={numPages}
                    min={1}
                    size="small"
                    type="number"
                    value={fullscreenPageNumber}
                    onChange={(e) => {
                      const value = parseInt(e.target.value);
                      if (!isNaN(value)) goToFullscreenPage(value);
                    }}
                  />
                  <span className={localStyles.fullscreenPageText}>/ {numPages}</span>
                </Flexbox>
                <Button
                  className={localStyles.fullscreenButton}
                  disabled={fullscreenPageNumber >= numPages}
                  icon={<ChevronRight size={16} />}
                  size="small"
                  type="text"
                  onClick={goToFullscreenNextPage}
                />
              </Flexbox>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
});

export default PdfPreview;
