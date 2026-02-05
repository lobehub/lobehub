// Polyfill DOMMatrix for pdfjs-dist in Node.js environment
import { DOMMatrix } from '@napi-rs/canvas';

if (typeof globalThis.DOMMatrix === 'undefined') {
  // @ts-ignore
  globalThis.DOMMatrix = DOMMatrix;
}

// Polyfill URL.createObjectURL and URL.revokeObjectURL for pdfjs-dist
if (typeof globalThis.URL.createObjectURL === 'undefined') {
  globalThis.URL.createObjectURL = () => 'blob:http://localhost/fake-blob-url';
}
if (typeof globalThis.URL.revokeObjectURL === 'undefined') {
  globalThis.URL.revokeObjectURL = () => {
    /* no-op */
  };
}
