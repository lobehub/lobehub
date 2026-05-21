import type { FileLoaderInterface, SupportedFileType } from '../types';
import { TextLoader } from './text';

// Lazy loader factory type - returns a Promise that resolves to the loader class
type LazyLoaderFactory = () => Promise<new () => FileLoaderInterface>;

// Loader configuration map using lazy imports for HEAVY formats only.
// pdf/doc/docx/excel/pptx pull in multi-MB parsers (pdfjs-dist, mammoth, xlsx, …)
// that should stay out of the main bundle until a file of that type is opened.
//
// TextLoader is intentionally NOT lazy: it only depends on node:fs/promises +
// a tiny utf-16 detect util (~10KB total). Splitting it into a dynamic chunk
// caused the chunk to back-reference the main bundle for `detectUtf16NoBom`,
// re-evaluating the main entry and re-running `new App()` →
// `protocol.registerSchemesAsPrivileged` after app ready → throw on every
// readFile of .md / .json / .ts / etc. See LOBE-* for the regression.
const lazyFileLoaders: Record<Exclude<SupportedFileType, 'txt'>, LazyLoaderFactory> = {
  doc: async () => {
    const { DocLoader } = await import('./doc');
    return DocLoader;
  },
  docx: async () => {
    const { DocxLoader } = await import('./docx');
    return DocxLoader;
  },
  excel: async () => {
    const { ExcelLoader } = await import('./excel');
    return ExcelLoader;
  },
  pdf: async () => {
    // Polyfill DOMMatrix for Node.js environment before importing pdfjs-dist
    // pdfjs-dist 5.x uses DOMMatrix at module initialization which doesn't exist in Node.js
    if (typeof globalThis.DOMMatrix === 'undefined') {
      try {
        const canvas = require('@napi-rs/canvas');
        globalThis.DOMMatrix = canvas.DOMMatrix;
        globalThis.DOMPoint = canvas.DOMPoint;
        globalThis.DOMRect = canvas.DOMRect;
        globalThis.Path2D = canvas.Path2D;
      } catch (e) {
        console.error('Error importing @napi-rs/canvas:', e);
        // @napi-rs/canvas not available, pdfjs-dist may fail if DOMMatrix is needed
      }
    }
    const { PdfLoader } = await import('./pdf');
    return PdfLoader;
  },
  pptx: async () => {
    const { PptxLoader } = await import('./pptx');
    return PptxLoader;
  },
};

/**
 * Get a file loader class for the specified file type.
 * Uses dynamic imports to avoid loading heavy dependencies (like pdfjs-dist) until needed.
 * TextLoader is returned synchronously (statically imported) for `txt` and as the
 * fallback for unknown types.
 */
export const getFileLoader = async (
  fileType: SupportedFileType | string,
): Promise<new () => FileLoaderInterface> => {
  if (fileType === 'txt') return TextLoader;
  const loaderFactory = lazyFileLoaders[fileType as Exclude<SupportedFileType, 'txt'>];
  if (!loaderFactory) return TextLoader;
  return loaderFactory();
};

// For backward compatibility - but prefer using getFileLoader for lazy loading
// This is kept to avoid breaking existing imports, but it will trigger immediate loading
// of all loaders. Consider migrating to getFileLoader.
export { lazyFileLoaders as fileLoaderFactories };
