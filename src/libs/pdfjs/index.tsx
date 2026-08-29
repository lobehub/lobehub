'use client';

// Use Vite's ?url import to get the correct hashed asset path (e.g. /_spa/assets/pdf.worker-xxx.mjs)
// This overrides react-pdf's auto-detected bare filename which breaks under SPA routing.
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { type ComponentProps, useEffect, useState } from 'react';
import { Document as PdfDocument, type Page as PdfPage, pdfjs } from 'react-pdf';

// Electron's custom `app://` protocol doesn't support `new Worker(url)` directly.
// Workaround: fetch the worker script via the protocol (which supportFetchAPI enables),
// then create a blob URL that Chromium's Worker constructor accepts.
let workerReady: Promise<void> | null = null;
let workerResolved = false;

const ensureWorkerSrc = (): Promise<void> => {
  if (workerReady) return workerReady;

  workerReady = (async () => {
    if (typeof window === 'undefined') return;

    if (window.location.protocol === 'app:') {
      try {
        const res = await fetch(pdfjsWorkerUrl);
        if (!res.ok) throw new Error(`Worker fetch failed: ${res.status}`);
        const blob = await res.blob();
        pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
      } catch {
        // Fallback to CDN if local fetch fails
        pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
      }
    } else {
      pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;
    }
    workerResolved = true;
  })();

  return workerReady;
};

// Eagerly kick off initialization at module load time
ensureWorkerSrc();

export type DocumentProps = ComponentProps<typeof PdfDocument>;
export type PageProps = ComponentProps<typeof PdfPage>;

export const Document = (props: DocumentProps) => {
  const [ready, setReady] = useState(workerResolved);

  useEffect(() => {
    ensureWorkerSrc().then(() => setReady(true));
  }, []);

  if (!ready) return (props.loading as React.ReactNode) ?? null;

  return <PdfDocument {...props} />;
};

export { Page, pdfjs } from 'react-pdf';
