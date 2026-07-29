/**
 * remark plugin — collapse the changelog "Improvements" and "Fixes" sections.
 *
 * Each changelog entry uses standardized section headings (Features /
 * Improvements / Fixes). "Improvements" and "Fixes" are long, low-signal lists,
 * so in the changelog modal we wrap each of those headings (plus the content
 * that follows it, up to the next same-or-higher heading) in a
 * `<collapsible-section>` element that renders collapsed by default to save
 * vertical space; "Features" stays expanded.
 *
 * Built for react-markdown: we emit a node with `data.hName`, so
 * mdast-util-to-hast turns it into a `<collapsible-section>` hast element, which
 * is resolved to the CollapsibleSection component via the `components` map
 * passed to <Markdown>. Headings inside code blocks are untouched because we
 * only walk the document's top-level children (fenced code is a single node).
 */

interface MdastNode {
  children?: MdastNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
  depth?: number;
  type: string;
  value?: string;
}

/** Section headings rendered collapsed by default (matched case-insensitively). */
export const COLLAPSIBLE_HEADINGS = new Set(['fixes', 'improvements']);

const nodeToText = (node: MdastNode): string => {
  if (typeof node.value === 'string') return node.value;
  if (node.children) return node.children.map(nodeToText).join('');
  return '';
};

const collapseSections = (tree: MdastNode) => {
  const children = tree.children;
  if (!children) return;

  const next: MdastNode[] = [];

  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    const depth = node.depth ?? 0;
    const title = node.type === 'heading' ? nodeToText(node).trim() : '';
    const isCollapsible = depth >= 2 && COLLAPSIBLE_HEADINGS.has(title.toLowerCase());

    if (!isCollapsible) {
      next.push(node);
      continue;
    }

    // Collect the section body: every node until the next same-or-higher heading.
    const body: MdastNode[] = [];
    let j = i + 1;
    for (; j < children.length; j++) {
      const sibling = children[j];
      if (sibling.type === 'heading' && (sibling.depth ?? 0) <= depth) break;
      body.push(sibling);
    }
    i = j - 1;

    next.push({
      children: body,
      data: { hName: 'collapsible-section', hProperties: { title } },
      type: 'collapsibleSection',
    });
  }

  tree.children = next;
};

const remarkCollapsibleSections = () => collapseSections;

export default remarkCollapsibleSections;
