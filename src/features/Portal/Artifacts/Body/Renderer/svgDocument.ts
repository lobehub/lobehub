/**
 * The preview canvas is always white, whatever the app theme, like a browser opening an `.svg`
 * file: generated SVGs routinely rely on the default black fill and text, which would vanish on a
 * dark, transparent backdrop.
 */
export const SVG_PREVIEW_BACKGROUND = '#fff';

const buildSvgSrcDoc = (content: string): string =>
  [
    '<!doctype html><html><head><meta charset="utf-8"><style>',
    ':root{color-scheme:light;}',
    `html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${SVG_PREVIEW_BACKGROUND};}`,
    'body{display:flex;align-items:center;justify-content:center;}',
    'body>svg{width:100%;height:100%;}',
    '</style></head><body>',
    content,
    '</body></html>',
  ].join('');

/**
 * Props for the iframe that previews an SVG artifact.
 *
 * The SVG is rendered verbatim instead of being sanitized into the app DOM: an inline SVG's
 * `<style>` would restyle the whole app, so inline rendering forced a lossy allowlist that silently
 * dropped `<style>` (CSS animations, class fills), `<foreignObject>`, SMIL tags and more. An empty
 * `sandbox` disables scripts and gives the document an opaque origin, and styles stay scoped to
 * the SVG's own document, so the preview matches what a browser shows when opening the file.
 */
export const getSvgFrameProps = (content: string) => ({
  sandbox: '',
  srcDoc: buildSvgSrcDoc(content),
});

/**
 * Serializes the artifact's root `<svg>` as a standalone SVG document sized to `width` × `height`,
 * ready to be loaded as an image for rasterization.
 *
 * The content is parsed as HTML, the same lenient way the preview parses it, so markup that is not
 * well-formed XML still exports; `XMLSerializer` then adds the namespaces an image load requires.
 * @returns `undefined` when the content has no `<svg>` element
 */
export const toStandaloneSvg = (
  content: string,
  width: number,
  height: number,
): string | undefined => {
  const doc = new DOMParser().parseFromString(content, 'text/html');
  const svg = doc.querySelector('svg');
  if (!svg) return;

  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));

  return new XMLSerializer().serializeToString(svg);
};

/**
 * Rasterizes SVG content to a PNG data URL at `scale` times the given CSS size.
 *
 * The SVG is drawn through an `<img>`, where browsers render it in secure static mode: scripts are
 * disabled and the first frame of any animation is captured.
 */
export const rasterizeSvg = async (
  content: string,
  { height, scale = 2, width }: { height: number; scale?: number; width: number },
): Promise<string> => {
  const svg = toStandaloneSvg(content, width, height);
  if (!svg) throw new Error('SVG content has no <svg> element');

  const image = new Image();
  // A data URL rather than a blob URL: Chromium taints the canvas when a blob-loaded SVG contains
  // `<foreignObject>`, and `toDataURL` then throws a SecurityError
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context is unavailable');

  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL('image/png');
};
