import { memo } from 'react';

interface HTMLRendererProps {
  height?: string;
  htmlContent: string;
  width?: string;
}

// Security boundary: the iframe runs in a unique opaque origin because the
// sandbox attribute does NOT include `allow-same-origin`. This blocks
// `window.parent.*` access (the GHSA-xq4x-622m-q8fq XSS-to-RCE path on
// Electron), denies access to the app's cookies / storage, and prevents
// top-level navigation, while still allowing scripts and styles to run so
// that LLM-generated single-file HTML demos (Tailwind CDN, p5.js, three.js,
// vanilla JS, etc.) actually work.
//
// IMPORTANT: never add `allow-same-origin` here — combining it with
// `allow-scripts` would let the iframe remove its own sandbox attribute and
// would reintroduce the original XSS-to-RCE vulnerability.
const HTMLRenderer = memo<HTMLRendererProps>(({ htmlContent, width = '100%', height = '100%' }) => {
  return (
    <iframe
      sandbox="allow-scripts allow-forms allow-popups allow-modals"
      srcDoc={htmlContent}
      style={{ border: 'none', height, width }}
      title="html-renderer"
    />
  );
});

export default HTMLRenderer;
