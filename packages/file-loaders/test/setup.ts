// Polyfill DOMMatrix for pdfjs-dist in Node.js environment
import { DOMMatrix } from '@napi-rs/canvas';

if (typeof global.DOMMatrix === 'undefined') {
  // @ts-ignore
  global.DOMMatrix = DOMMatrix;
}

// Polyfill URL.createObjectURL and URL.revokeObjectURL for pdfjs-dist
if (typeof global.URL.createObjectURL === 'undefined') {
  global.URL.createObjectURL = () => 'blob:http://localhost/fake-blob-url';
}
if (typeof global.URL.revokeObjectURL === 'undefined') {
  global.URL.revokeObjectURL = () => {
    /* no-op */
  };
}
