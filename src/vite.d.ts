import 'vite/client';

declare module '*.md' {
  const content: string;
  export default content;
}

declare module 'pdfjs-dist/build/pdf.worker.min.mjs?url' {
  const url: string;
  export default url;
}

export {};
