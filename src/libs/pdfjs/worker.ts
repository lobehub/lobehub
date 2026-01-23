'use client';

import { pdfjs } from 'react-pdf';

pdfjs.GlobalWorkerOptions.workerSrc = `https://registry.npmmirror.com/pdfjs-dist/${pdfjs.version}/files/build/pdf.worker.min.mjs`;

// TODO: Re-enable module worker when fully on Turbopack.
// if (typeof Worker !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerPort) {
//   pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL('./pdf.worker.ts', import.meta.url), {
//     type: 'module',
//   });
// }
