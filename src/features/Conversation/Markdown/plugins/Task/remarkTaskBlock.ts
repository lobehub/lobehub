import { SKIP, visit } from 'unist-util-visit';

import { TASK_TAG } from '@/const/plugin';

import { treeNodeToString } from '../remarkPlugins/getNodeContent';

const OPEN_TAG = `<${TASK_TAG}>`;
const CLOSE_TAG = `</${TASK_TAG}>`;

/**
 * Captures `<task>...</task>` blocks from a markdown AST. Unlike
 * `createRemarkCustomTagPlugin`, this handles the common case where remark
 * parses the opening `<task>` together with the surrounding lines into a
 * single html block, and where the closing `</task>` is buried inside a
 * later paragraph node.
 */
export const remarkTaskBlock = () => (tree: any) => {
  visit(tree, (node, index, parent) => {
    if (!parent || index == null) return;
    if (node.type !== 'html') return;
    if (typeof node.value !== 'string') return;

    const openIdx = node.value.indexOf(OPEN_TAG);
    if (openIdx === -1) return;

    // Same node may already contain the closing tag.
    const sameNodeCloseIdx = node.value.indexOf(CLOSE_TAG, openIdx + OPEN_TAG.length);
    if (sameNodeCloseIdx !== -1) {
      const inner = node.value.slice(openIdx + OPEN_TAG.length, sameNodeCloseIdx).trim();
      const replacement = buildTaskNode(inner, node.position);
      parent.children.splice(index, 1, replacement);
      return [SKIP, index + 1];
    }

    // Otherwise capture content from this node up to the closing tag in a
    // sibling node.
    const headInner = node.value.slice(openIdx + OPEN_TAG.length);
    const collected: string[] = [headInner];
    let cursor = (index as number) + 1;
    let closingFound = false;
    let closingTrailing = '';

    while (cursor < parent.children.length) {
      const sibling = parent.children[cursor];
      const closeInSibling = findCloseInSubtree(sibling);
      if (closeInSibling) {
        collected.push(closeInSibling.before);
        closingTrailing = closeInSibling.after.trim();
        closingFound = true;
        break;
      }
      collected.push(treeNodeToString([sibling]));
      cursor++;
    }

    if (!closingFound) return;

    const inner = collected.join('\n').trim();
    const replacement = buildTaskNode(inner, node.position);

    const removeCount = cursor - (index as number) + 1;
    const newNodes: any[] = [replacement];
    if (closingTrailing) {
      newNodes.push({
        type: 'paragraph',
        children: [{ type: 'text', value: closingTrailing }],
      });
    }
    parent.children.splice(index, removeCount, ...newNodes);
    return [SKIP, index + newNodes.length];
  });
};

const buildTaskNode = (inner: string, position?: any) => ({
  type: `${TASK_TAG}Block`,
  data: {
    hName: TASK_TAG,
    hChildren: [{ type: 'text', value: inner }],
  },
  position,
});

interface CloseMatch {
  after: string;
  before: string;
}

/**
 * Walks a node subtree looking for the closing tag. Returns the text content
 * before the tag (preserving everything we want as the inner body) and any
 * stray text after the tag (so we don't drop content that follows in the same
 * paragraph). Returns null if the closing tag is not found.
 */
const findCloseInSubtree = (root: any): CloseMatch | null => {
  // Direct html node with the closing tag.
  if (root.type === 'html' && typeof root.value === 'string') {
    const idx = root.value.indexOf(CLOSE_TAG);
    if (idx !== -1) {
      return {
        before: root.value.slice(0, idx),
        after: root.value.slice(idx + CLOSE_TAG.length),
      };
    }
    return null;
  }

  if (!root.children || !Array.isArray(root.children)) return null;

  const beforeParts: string[] = [];
  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i];
    if (child.type === 'html' && typeof child.value === 'string') {
      const idx = child.value.indexOf(CLOSE_TAG);
      if (idx !== -1) {
        beforeParts.push(child.value.slice(0, idx));
        const after = child.value.slice(idx + CLOSE_TAG.length);
        return {
          before: beforeParts.join(''),
          after,
        };
      }
    }
    const nested = findCloseInSubtree(child);
    if (nested) {
      beforeParts.push(nested.before);
      return { before: beforeParts.join(''), after: nested.after };
    }
    beforeParts.push(treeNodeToString([child]));
  }

  return null;
};
