import { memo } from 'react';

interface HTMLRendererProps {
  height?: string;
  htmlContent: string;
  width?: string;
}

const SANDBOX_STORAGE_SHIM = `<script data-lobe-artifact-storage-shim>
(() => {
  if (window.__lobeArtifactStorageShim) return;
  Object.defineProperty(window, '__lobeArtifactStorageShim', { value: true });

  const createStorage = () => {
    const data = Object.create(null);

    return {
      clear() {
        for (const key of Object.keys(data)) delete data[key];
      },
      getItem(key) {
        const normalizedKey = String(key);
        return Object.prototype.hasOwnProperty.call(data, normalizedKey) ? data[normalizedKey] : null;
      },
      key(index) {
        return Object.keys(data)[index] ?? null;
      },
      get length() {
        return Object.keys(data).length;
      },
      removeItem(key) {
        delete data[String(key)];
      },
      setItem(key, value) {
        data[String(key)] = String(value);
      },
    };
  };

  const defineStorage = (name) => {
    try {
      void window[name];
      return;
    } catch {
      Object.defineProperty(window, name, {
        configurable: true,
        value: createStorage(),
      });
    }
  };

  defineStorage('localStorage');
  defineStorage('sessionStorage');
})();
</script>`;

const SCRIPT_TAG_REGEX = /<script\b/i;
const HEAD_TAG_REGEX = /<head(?:\s[^>]*)?>/i;
const HTML_TAG_REGEX = /<html(?:\s[^>]*)?>/i;

const findTagBeforeFirstScript = (htmlContent: string, tagRegex: RegExp) => {
  const firstScriptIndex = htmlContent.search(SCRIPT_TAG_REGEX);
  const searchableContent =
    firstScriptIndex === -1 ? htmlContent : htmlContent.slice(0, firstScriptIndex);
  const match = searchableContent.match(tagRegex);

  if (!match?.[0] || match.index === undefined) return;

  return {
    index: match.index,
    value: match[0],
  };
};

const insertAfterTag = (htmlContent: string, tag: { index: number; value: string }) => {
  const insertIndex = tag.index + tag.value.length;
  return `${htmlContent.slice(0, insertIndex)}\n${SANDBOX_STORAGE_SHIM}${htmlContent.slice(
    insertIndex,
  )}`;
};

export const injectSandboxStorageShim = (htmlContent: string) => {
  if (htmlContent.includes('data-lobe-artifact-storage-shim')) return htmlContent;

  const headTag = findTagBeforeFirstScript(htmlContent, HEAD_TAG_REGEX);
  if (headTag) return insertAfterTag(htmlContent, headTag);

  const htmlTag = findTagBeforeFirstScript(htmlContent, HTML_TAG_REGEX);
  if (htmlTag) {
    const insertIndex = htmlTag.index + htmlTag.value.length;
    return `${htmlContent.slice(0, insertIndex)}\n<head>${SANDBOX_STORAGE_SHIM}</head>${htmlContent.slice(
      insertIndex,
    )}`;
  }

  return `${SANDBOX_STORAGE_SHIM}\n${htmlContent}`;
};

// Security boundary: the iframe runs in a unique opaque origin because the
// sandbox attribute does NOT include `allow-same-origin`. This blocks
// `window.parent.*` access (the GHSA-xq4x-622m-q8fq XSS-to-RCE path on
// Electron), denies access to the app's cookies / storage, and prevents
// top-level navigation, while still allowing scripts and styles to run so
// that LLM-generated single-file HTML demos (Tailwind CDN, p5.js, three.js,
// vanilla JS, etc.) actually work.
//
// IMPORTANT — do NOT add the following capabilities:
//   - `allow-same-origin`: combined with `allow-scripts` it lets the iframe
//     remove its own sandbox and reintroduces the original XSS-to-RCE.
//   - `allow-popups`: in the Electron desktop app `setWindowOpenHandler`
//     unconditionally forwards `window.open(url)` to `shell.openExternal`,
//     which means untrusted artifact scripts could launch arbitrary
//     protocol handlers / external URLs with zero user interaction.
//   - `allow-top-navigation` (any flavor): would let the artifact hijack
//     the host window.
const HTMLRenderer = memo<HTMLRendererProps>(({ htmlContent, width = '100%', height = '100%' }) => {
  return (
    <iframe
      sandbox="allow-scripts allow-forms allow-modals"
      srcDoc={injectSandboxStorageShim(htmlContent)}
      style={{ border: 'none', height, width }}
      title="html-renderer"
    />
  );
});

export default HTMLRenderer;
