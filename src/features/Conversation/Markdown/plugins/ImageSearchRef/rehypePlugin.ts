import { SKIP, visit } from 'unist-util-visit';

export const IMAGE_SEARCH_REF_TAG = 'image-search-ref';

/** Matches filenames like image_0.png, image_12.jpg produced by Gemini image search */
const IMAGE_REF_REGEX = /\bimage_(\d+)\.(?:png|jpe?g|gif|webp)\b/gi;

/**
 * Rehype plugin that transforms plain-text Gemini image references (e.g. `image_0.png`)
 * appearing in message content into custom `<image-search-ref>` HAST elements.
 *
 * The transformation only rewrites text nodes – markdown image syntax is untouched.
 */
export const rehypeImageSearchRef = () => (tree: any) => {
  visit(tree, 'text', (node: any, index: number | undefined, parent: any) => {
    if (index === undefined || !parent) return;

    const value = String(node.value);

    // Quick check to avoid expensive processing for most nodes
    IMAGE_REF_REGEX.lastIndex = 0;
    if (!IMAGE_REF_REGEX.test(value)) return;

    IMAGE_REF_REGEX.lastIndex = 0;
    const segments: any[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = IMAGE_REF_REGEX.exec(value)) !== null) {
      // Preserve preceding text
      if (match.index > lastIndex) {
        segments.push({ type: 'text', value: value.slice(lastIndex, match.index) });
      }

      segments.push({
        children: [{ type: 'text', value: match[0] }],
        properties: {
          imageIndex: Number(match[1]),
          originalText: match[0],
        },
        tagName: IMAGE_SEARCH_REF_TAG,
        type: 'element',
      });

      lastIndex = match.index + match[0].length;
    }

    // Preserve trailing text
    if (lastIndex < value.length) {
      segments.push({ type: 'text', value: value.slice(lastIndex) });
    }

    // No actual replacements – exit early (shouldn't happen given test above)
    if (segments.length === 0) return;

    parent.children.splice(index, 1, ...segments);
    return [SKIP, index + segments.length];
  });
};
