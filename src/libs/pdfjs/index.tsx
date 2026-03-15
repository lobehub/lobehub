'use client';

import { type ComponentProps } from 'react';
import { type Page as PdfPage } from 'react-pdf';
import { Document as PdfDocument, pdfjs } from 'react-pdf';

// Use Vite's ?url import to get the correct hashed asset path (e.g. /spa/assets/pdf.worker-xxx.mjs)
// This overrides react-pdf's auto-detected bare filename which breaks under SPA routing.
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

export type DocumentProps = ComponentProps<typeof PdfDocument>;
export type PageProps = ComponentProps<typeof PdfPage>;

export const Document = (props: DocumentProps) => {
  return <PdfDocument {...props} />;
};

export { Page, pdfjs } from 'react-pdf';
