import { SKIP, visit } from 'unist-util-visit';

import { treeNodeToString } from './getNodeContent';

const unescapeAttribute = (value: string) =>
  value
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');

/** `key="value"` pairs of an open tag, values unescaped. */
export const parseXmlAttributes = (raw: string): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const match of raw.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    result[match[1]] = unescapeAttribute(match[2]);
  }
  return result;
};

/**
 * Captures `<tag …>…</tag>` blocks the server injects into a message from a
 * markdown AST into one node carrying the open tag's attributes as properties
 * and the raw inner text as its only child.
 *
 * The server emits the block without blank lines, so CommonMark keeps it in
 * a single `html` node and the inner text arrives verbatim. Should a blank
 * line ever sneak in, the closing tag is searched in the following siblings
 * and their content re-serialised, at the cost of exact whitespace.
 */
export const createRemarkXmlBlockPlugin = (tag: string) => {
  const openRe = new RegExp(String.raw`<${tag}\b([^>]*)>`);
  const closeTag = `</${tag}>`;

  const buildNode = (attributes: Record<string, string>, inner: string, position?: any) => ({
    data: {
      hChildren: [{ type: 'text', value: inner }],
      hName: tag,
      hProperties: attributes,
    },
    position,
    type: `${tag}Block`,
  });

  return () => (tree: any) => {
    visit(tree, 'html', (node, index, parent) => {
      if (!parent || index == null || typeof node.value !== 'string') return;

      const open = openRe.exec(node.value);
      if (!open) return;
      const attributes = parseXmlAttributes(open[1] ?? '');
      const afterOpen = open.index + open[0].length;

      const sameNodeClose = node.value.indexOf(closeTag, afterOpen);
      if (sameNodeClose !== -1) {
        const inner = node.value.slice(afterOpen, sameNodeClose).trim();
        parent.children.splice(index, 1, buildNode(attributes, inner, node.position));
        return [SKIP, index + 1];
      }

      const collected: string[] = [node.value.slice(afterOpen)];
      let cursor = index + 1;
      let closed = false;
      while (cursor < parent.children.length) {
        const sibling = parent.children[cursor];
        const text =
          sibling.type === 'html' && typeof sibling.value === 'string'
            ? sibling.value
            : treeNodeToString([sibling]);
        const closeAt = text.indexOf(closeTag);
        if (closeAt !== -1) {
          collected.push(text.slice(0, closeAt));
          closed = true;
          break;
        }
        collected.push(text);
        cursor++;
      }
      if (!closed) return;

      const inner = collected.join('\n').trim();
      parent.children.splice(
        index,
        cursor - index + 1,
        buildNode(attributes, inner, node.position),
      );
      return [SKIP, index + 1];
    });
  };
};
