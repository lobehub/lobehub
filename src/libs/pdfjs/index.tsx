'use client';

import { type ComponentProps } from 'react';
import { type Page as PdfPage } from 'react-pdf';
import { Document as PdfDocument, pdfjs } from 'react-pdf';

const workerSrc = `https://registry.npmmirror.com/pdfjs-dist/${pdfjs.version}/files/build/pdf.worker.min.mjs`;

function ensureWorker() {
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  }
}

export type DocumentProps = ComponentProps<typeof PdfDocument>;
export type PageProps = ComponentProps<typeof PdfPage>;

export const Document = (props: DocumentProps) => {
  ensureWorker();
  return <PdfDocument {...props} />;
};

export { Page, pdfjs } from 'react-pdf';
