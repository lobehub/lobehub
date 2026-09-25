import { SKIP, visit } from 'unist-util-visit';

import { SCM_EVENT_TAG } from '@/const/plugin';

import { treeNodeToString } from '../remarkPlugins/getNodeContent';
import { parseAttributes } from './parseScmEvent';

const OPEN_RE = new RegExp(String.raw`<${SCM_EVENT_TAG}\b([^>]*)>`);
const CLOSE_TAG = `</${SCM_EVENT_TAG}>`;

/**
 * Captures `<scmEvent …>…</scmEvent>` blocks from a markdown AST into one
 * node carrying the open tag's attributes as properties and the raw inner
 * text as its only child.
 *
 * The server emits the block without blank lines, so CommonMark keeps it in
 * a single `html` node and the inner text arrives verbatim. Should a blank
 * line ever sneak in, the closing tag is searched in the following siblings
 * and their content re-serialised, at the cost of exact whitespace.
 */
export const remarkScmEventBlock = () => (tree: any) => {
  visit(tree, 'html', (node, index, parent) => {
    if (!parent || index == null || typeof node.value !== 'string') return;

    const open = OPEN_RE.exec(node.value);
    if (!open) return;
    const attributes = parseAttributes(open[1] ?? '');
    const afterOpen = open.index + open[0].length;

    const sameNodeClose = node.value.indexOf(CLOSE_TAG, afterOpen);
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
      const closeAt = text.indexOf(CLOSE_TAG);
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
    parent.children.splice(index, cursor - index + 1, buildNode(attributes, inner, node.position));
    return [SKIP, index + 1];
  });
};

const buildNode = (attributes: Record<string, string>, inner: string, position?: any) => ({
  data: {
    hChildren: [{ type: 'text', value: inner }],
    hName: SCM_EVENT_TAG,
    hProperties: attributes,
  },
  position,
  type: `${SCM_EVENT_TAG}Block`,
});
