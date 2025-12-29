'use client';

import { Flexbox } from '@lobehub/ui';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Fragment, memo, useCallback, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

import { lambdaQuery } from '@/libs/trpc/client';

import HighlightLayer from './HighlightLayer';
import { styles } from './style';
import useResizeObserver from './useResizeObserver';

// 如果海外的地址： https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs
pdfjs.GlobalWorkerOptions.workerSrc = `https://registry.npmmirror.com/pdfjs-dist/${pdfjs.version}/files/build/pdf.worker.min.mjs`;

const options = {
  cMapUrl: `https://registry.npmmirror.com/pdfjs-dist/${pdfjs.version}/files/cmaps/`,
  standardFontDataUrl: `https://registry.npmmirror.com/pdfjs-dist/${pdfjs.version}/files/standard_fonts/`,
};

const maxWidth = 1200;

interface PDFViewerProps {
  fileId: string;
  url: string | null;
}

const PDFViewer = memo<PDFViewerProps>(({ url, fileId }) => {
  const [numPages, setNumPages] = useState<number>(0);
  const [containerRef, setContainerRef] = useState<HTMLElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>();
  const [isLoaded, setIsLoaded] = useState(false);

  // eslint-disable-next-line no-undef
  const onResize = useCallback<ResizeObserverCallback>((entries) => {
    const [entry] = entries;

    if (entry) {
      setContainerWidth(entry.contentRect.width);
    }
  }, []);

  useResizeObserver(containerRef, onResize);

  const onDocumentLoadSuccess = ({ numPages: nextNumPages }: PDFDocumentProxy) => {
    setNumPages(nextNumPages);
    setIsLoaded(true);
  };

  const { data } = lambdaQuery.chunk.getChunksByFileId.useInfiniteQuery(
    { id: fileId },
    { getNextPageParam: (lastPage) => lastPage.nextCursor },
  );

  const dataSource = data?.pages.flatMap((page) => page.items) || [];

  return (
    <Flexbox className={styles.container}>
      <Flexbox
        align={'center'}
        className={styles.documentContainer}
        padding={24}
        ref={setContainerRef}
        style={{ height: isLoaded ? undefined : '100%' }}
      >
        <Document
          className={styles.document}
          file={url}
          onLoadSuccess={onDocumentLoadSuccess}
          options={options}
        >
          {Array.from({ length: numPages }, (el, index) => {
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
