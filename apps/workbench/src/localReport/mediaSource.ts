type MediaSource = { type: 'external' | 'local'; url: string } | { type: 'unavailable' };

/** Local reports never fetch remote media, even when the browser is online. */
export const mediaSource = (src?: string): MediaSource => {
  if (!src?.trim()) return { type: 'unavailable' };
  // URL parsers normalize backslashes and control characters; check the parsed
  // destination rather than trusting a prefix such as "./" or "https:".
  try {
    const url = new URL(src, 'https://local-report.invalid/');
    if (url.protocol === 'data:' || url.protocol === 'blob:') return { type: 'local', url: src };
    if (/^https?:$/.test(url.protocol)) {
      // eslint-disable-next-line no-control-regex
      const hasControlCharacters = /[\u0000-\u001F\u007F]/.test(src);
      const relative = !/^[a-z][\w+.-]*:|^[\\/]/i.test(src.trim()) && !hasControlCharacters;
      if (relative && url.origin === 'https://local-report.invalid')
        return { type: 'local', url: src };
      // An absolute disk path cannot travel with the report. Do not invent a
      // link to the synthetic parsing origin for it.
      if (/^[\\/](?![\\/])/.test(src.trim())) return { type: 'unavailable' };
      return { type: 'external', url: url.href };
    }
  } catch {
    // Invalid and executable URLs are not made into links.
  }
  return { type: 'unavailable' };
};
