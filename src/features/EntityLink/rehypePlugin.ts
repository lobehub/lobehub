import { SKIP, visit } from 'unist-util-visit';

import { LOBE_LINK_TAG, parseLobeLink } from './parse';

/** Recursively collect the visible text of a HAST node. */
const getNodeText = (node: any): string => {
  if (!node) return '';
  if (node.type === 'text') return String(node.value ?? '');
  if (Array.isArray(node.children)) return node.children.map(getNodeText).join('');
  return '';
};

/**
 * Rehype plugin that rewrites GitHub / Linear anchor (`<a>`) elements into a
 * custom `<lobeLink>` element so they can be rendered as rich inline chips.
 *
 * Anchors that are not GitHub / Linear links – including citation links
 * (`citation-1`) and footnote refs – are left untouched and keep the default
 * link renderer.
 */
export const rehypeLobeLink = () => (tree: any) => {
  visit(tree, 'element', (node: any) => {
    if (node.tagName !== 'a') return;

    const href = node.properties?.href as string | undefined;
    const parsed = parseLobeLink(href);
    if (!parsed) return;

    const text = getNodeText(node).trim();
    // Prefer an author-provided label; fall back to the canonical short form
    // when the link text is empty or just the raw URL.
    const label = !text || text === href ? parsed.canonicalLabel : text;

    node.tagName = LOBE_LINK_TAG;
    node.children = [];
    node.properties = {
      linkDomain: parsed.domain,
      linkHref: href,
      linkKind: parsed.kind,
      linkLabel: label,
    };

    return SKIP;
  });
};
