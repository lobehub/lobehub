'use client';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import { Flexbox, Spin } from '@lobehub/ui';
import { Fragment, memo, useCallback, useState } from 'react';

import { Document, Page, pdfjs } from '@/libs/pdfjs';

import HighlightLayer from './HighlightLayer';
import { styles } from './style';
import { useChunkHighlights } from './useChunkHighlights';
import useResizeObserver from './useResizeObserver';

const options = {
  cMapUrl: `https://registry.npmmirror.com/pdfjs-dist/${pdfjs.version}/files/cmaps/`,
  standardFontDataUrl: `https://registry.npmmirror.com/pdfjs-dist/${pdfjs.version}/files/standard_fonts/`,
};

const maxWidth = 1200;

export interface PDFViewerProps {
  fileId: string;
  /**
   * Overlay the file's retrieval chunks on the pages. Turn off for a file the
   * viewer does not own; see {@link useChunkHighlights}.
   * @default true
   */
  showChunkHighlights?: boolean;
  url: string | null;
}

const PDFViewer = memo<PDFViewerProps>(({ url, fileId, showChunkHighlights = true }) => {
  const [numPages, setNumPages] = useState<number>(0);
  const [containerRef, setContainerRef] = useState<HTMLElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>();
  const [isLoaded, setIsLoaded] = useState(false);

  const onResize = useCallback<ResizeObserverCallback>((entries) => {
    const [entry] = entries;

    if (entry) {
      setContainerWidth(entry.contentRect.width);
    }
  }, []);

  useResizeObserver(containerRef, onResize);

  const onDocumentLoadSuccess = (document: unknown) => {
    setNumPages((document as { numPages: number }).numPages);
    setIsLoaded(true);
  };

  const dataSource = useChunkHighlights(fileId, showChunkHighlights);

  return (
    <Flexbox className={styles.container}>
      <Flexbox
        align={'center'}
        className={styles.documentContainer}
        justify={isLoaded ? undefined : 'center'}
        padding={24}
        ref={setContainerRef}
      >
        <Document
          className={styles.document}
          file={url}
          loading={<Spin size="large" />}
          options={options}
          onLoadSuccess={onDocumentLoadSuccess}
        >
          {Array.from({ length: numPages }, (_, index) => {
            const width = containerWidth ? Math.min(containerWidth, maxWidth) : maxWidth;

            return (
              <Fragment key={`page_${index + 1}`}>
                <Page className={styles.page} pageNumber={index + 1} width={width}>
                  <HighlightLayer dataSource={dataSource} pageNumber={index + 1} width={width} />
                </Page>
              </Fragment>
            );
          })}
        </Document>
      </Flexbox>
    </Flexbox>
  );
});

export default PDFViewer;
