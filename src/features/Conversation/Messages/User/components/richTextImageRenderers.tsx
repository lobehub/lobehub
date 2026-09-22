import type { NodeRenderer } from '@lobehub/editor/renderer';
import { Image } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import type { CSSProperties } from 'react';

const styles = createStaticStyles(({ css }) => ({
  blockImage: css`
    position: relative;
    display: block;
    text-align: center;
  `,
  image: css`
    position: relative;
    display: inline-block;
  `,
}));

/**
 * The stored size the author picked with the resize handles. Mirrors the
 * renderer's stock image node: an untouched image carries `inherit` and gets no
 * inline size, so downstream thumbnail rules can tell it apart from a resized one.
 */
const getStoredImageStyle = (node: Record<string, any>): CSSProperties => {
  const { width, height, maxWidth } = node;
  const style: CSSProperties = {};
  if (maxWidth) style.maxWidth = maxWidth;
  if (width && width !== 'inherit') style.width = width;
  if (height && height !== 'inherit') style.height = height;
  return style;
};

/**
 * `Image` inlines its own sizing defaults (`max-width: 100%`, `max-height: 100%`,
 * `object-fit`). Clear them so the rendered `<img>` keeps exactly the markup the
 * stock renderer produced, with only the preview behaviour added on top.
 */
const createImageStyles = (node: Record<string, any>) => ({
  image: {
    height: undefined,
    maxHeight: undefined,
    maxWidth: undefined,
    objectFit: undefined,
    width: undefined,
    ...getStoredImageStyle(node),
  },
});

const renderPreviewableImage = (
  node: Record<string, any>,
  key: string,
  Wrapper: 'figure' | 'span',
  className: string,
) => (
  <Wrapper className={className} key={key}>
    <Image
      alt={node.altText || ''}
      src={node.src}
      styles={createImageStyles(node)}
      variant={'borderless'}
    />
  </Wrapper>
);

/**
 * `LexicalRenderer` overrides that make rendered images zoomable. The stock
 * `image` / `block-image` renderers emit a bare `<img>` with no click handler,
 * so an image inside a published comment could not be enlarged (LOBE-14115).
 * Rendering through `Image` opens the shared viewer on click; wrap the renderer
 * in a `PreviewGroup` so several images in one message become a gallery.
 */
export const richTextImageRenderers: Record<string, NodeRenderer> = {
  'block-image': (node, key) => renderPreviewableImage(node, key, 'figure', styles.blockImage),
  'image': (node, key) => renderPreviewableImage(node, key, 'span', styles.image),
};
