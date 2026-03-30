import type { Parent } from 'unist';
import { SKIP, visit } from 'unist-util-visit';

import { treeNodeToString } from './getNodeContent';

interface CreateRemarkCustomTagPluginOptions {
  position?: 'any' | 'leading';
}

const isLeadingTagPosition = (parent: Parent, startIndex: number) =>
  treeNodeToString(parent.children.slice(0, startIndex) as Parent[]).trim() === '';

export const createRemarkCustomTagPlugin =
  (tag: string, { position = 'any' }: CreateRemarkCustomTagPluginOptions = {}) =>
  () => {
    return (tree: any) => {
      visit(tree, 'html', (node, index, parent) => {
        if (!parent || index === undefined || index === null || node.value !== `<${tag}>`) return;

        const startIndex = index as number;

        if (position === 'leading' && !isLeadingTagPosition(parent as Parent, startIndex)) return;

        let endIndex = startIndex + 1;
        let hasCloseTag = false;

        // Find the closing tag
        while (endIndex < parent.children.length) {
          const sibling = parent.children[endIndex];
          if (sibling.type === 'html' && sibling.value === `</${tag}>`) {
            hasCloseTag = true;
            break;
          }
          endIndex++;
        }

        // Calculate the range of nodes to delete
        const deleteCount = hasCloseTag
          ? endIndex - startIndex + 1
          : parent.children.length - startIndex;

        // Extract content nodes
        const contentNodes = parent.children.slice(
          startIndex + 1,
          hasCloseTag ? endIndex : undefined,
        );

        const content = treeNodeToString(contentNodes);

        const customNode = {
          data: {
            hChildren: [{ type: 'text', value: content }],
            hName: tag,
          },
          position: node.position,
          type: `${tag}Block`,
        };

        parent.children.splice(startIndex, deleteCount, customNode);

        return [SKIP, startIndex + 1];
      });
    };
  };
