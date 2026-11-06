'use client';

import { Button, createModal, Flexbox, Input, Spin } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ChevronLeft, ChevronRight, Expand } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';
import { Document, Page } from '@/libs/pdfjs';

import { previewClassName } from '../style';

const styles = stylex.create({
  containerWrapper: { position: 'relative', width: '100%', height: '100%' },
  documentLoading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    padding: '20px',
  },
  expandButton: {
    position: 'absolute',
    zIndex: 1000,
    insetBlockStart: '20px',
    insetInlineEnd: '20px',
  },
  footerNavigation: {
    position: 'absolute',
    zIndex: 10,
    insetBlockEnd: 0,
    insetInline: 0,
    padding: '12px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: 'color-mix(in srgb, black 10%, transparent)',
    backgroundColor: 'color-mix(in srgb, white 90%, transparent)',
    backgroundImage: 'none',
    backdropFilter: 'blur(8px)',
  },
  fullscreenButton: { borderColor: 'white', color: 'white' },
  fullscreenContent: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    minHeight: '100%',
    padding: '20px',
  },
  fullscreenModal: { position: 'relative', overflow: 'auto', height: '90vh' },
  fullscreenNavigation: {
    position: 'fixed',
    zIndex: 1001,
    insetBlockEnd: '20px',
    insetInlineStart: '50%',
    transform: 'translateX(-50%)',
    paddingBlock: '12px',
    paddingInline: '20px',
    borderRadius: '8px',
    backgroundColor: 'color-mix(in srgb, black 70%, transparent)',
    backgroundImage: 'none',
    backdropFilter: 'blur(8px)',
  },
  fullscreenPageInput: { width: '60px' },
  fullscreenPageText: { minWidth: '20px', fontSize: '14px', color: 'white' },
  loadingState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    minHeight: '320px',
  },
  loadingText: { marginBlockStart: '8px', color: '#666' },
  pageInput: { width: '50px' },
  pageNumberText: { fontSize: '12px', color: '#666' },
  previewContainer: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '12px',
  },
});

interface FullscreenContentProps {
  initialPage: number;
  pdfDataUri: string;
}

const FullscreenContent = memo<FullscreenContentProps>(({ pdfDataUri, initialPage }) => {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(initialPage);

  const goToPrev = () => {
    if (pageNumber > 1) setPageNumber(pageNumber - 1);
  };

  const goToNext = () => {
    if (pageNumber < numPages) setPageNumber(pageNumber + 1);
  };

  const goToPage = (page: number) => {
    if (page >= 1 && page <= numPages) setPageNumber(page);
  };

  return (
    <div {...stylex.props(styles.fullscreenModal)}>
      <div {...stylex.props(styles.fullscreenContent)}>
        <Document
          file={pdfDataUri}
          onLoadSuccess={({ numPages: total }: { numPages: number }) => setNumPages(total)}
        >
          <Page
            pageNumber={pageNumber}
            renderAnnotationLayer={false}
            renderTextLayer={false}
            width={Math.min(window.innerWidth * 0.8, 1000)}
          />
        </Document>
      </div>

      {numPages > 1 && (
        <div {...stylex.props(styles.fullscreenNavigation)}>
          <Flexbox horizontal align="center" gap={12}>
            <Button
              className={stylex.props(styles.fullscreenButton).className}
              disabled={pageNumber <= 1}
              icon={<ChevronLeft size={16} />}
              size="small"
              type="text"
              onClick={goToPrev}
            />
            <Flexbox horizontal align="center" gap={8}>
              <Input
                className={stylex.props(styles.fullscreenPageInput).className}
                max={numPages}
                min={1}
                size="small"
                styles={{ input: { textAlign: 'center' } }}
                type="number"
                value={pageNumber}
                onChange={(e) => {
                  const value = parseInt(e.target.value);
                  if (!isNaN(value)) goToPage(value);
                }}
              />
              <span {...stylex.props(styles.fullscreenPageText)}>/ {numPages}</span>
            </Flexbox>
            <Button
              className={stylex.props(styles.fullscreenButton).className}
              disabled={pageNumber >= numPages}
              icon={<ChevronRight size={16} />}
              size="small"
              type="text"
              onClick={goToNext}
            />
          </Flexbox>
        </div>
      )}
    </div>
  );
});

FullscreenContent.displayName = 'PdfFullscreenContent';

const openPdfFullscreenModal = (pdfDataUri: string, initialPage: number) =>
  createModal({
    content: <FullscreenContent initialPage={initialPage} pdfDataUri={pdfDataUri} />,
    footer: null,
    maskClosable: true,
    styles: {
      content: { padding: 0 },
      header: { display: 'none' },
    },
    width: '95vw',
  });

interface PdfPreviewProps {
  pdfData: string | null;
}

const PdfPreview = memo<PdfPreviewProps>(({ pdfData }) => {
  const { t } = useTranslation('chat');
  const isMobile = useIsMobile();

  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);

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

  if (!pdfData) {
    return (
      <div className={previewClassName('text')}>
        <div {...stylex.props(styles.loadingState)}>
          <Spin size={24} />
          <div {...stylex.props(styles.loadingText)}>{t('shareModal.generatingPdf')}</div>
        </div>
      </div>
    );
  }

  const pdfDataUri = `data:application/pdf;base64,${pdfData}`;

  const handleFullscreen = () => {
    if (pdfData) openPdfFullscreenModal(pdfDataUri, pageNumber);
  };

  return (
    <div {...stylex.props(styles.containerWrapper)}>
      <Button
        className={stylex.props(styles.expandButton).className}
        icon={<Expand size={16} />}
        size="small"
        type="text"
        onClick={handleFullscreen}
      />

      <div
        className={`${previewClassName('text')} ${stylex.props(styles.previewContainer).className}`}
      >
        <Document
          file={pdfDataUri}
          loading={
            <div {...stylex.props(styles.documentLoading)}>
              <Spin />
              <div {...stylex.props(styles.loadingText)}>{t('shareModal.loadingPdf')}</div>
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

      {numPages > 1 && (
        <div {...stylex.props(styles.footerNavigation)}>
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
                className={stylex.props(styles.pageInput).className}
                max={numPages}
                min={1}
                size="small"
                styles={{ input: { textAlign: 'center' } }}
                type="number"
                value={pageNumber}
                onChange={(e) => {
                  const value = parseInt(e.target.value);
                  if (!isNaN(value)) goToPage(value);
                }}
              />
              <span {...stylex.props(styles.pageNumberText)}>/ {numPages}</span>
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
  );
});

export default PdfPreview;
