import { SKIP, visit } from 'unist-util-visit';

import { treeNodeToString } from './getNodeContent';

export const createRemarkCustomTagPlugin = (tag: string) => () => {
  return (tree: any) => {
    visit(tree, 'html', (node, index, parent) => {
      if (node.value === `<${tag}>`) {
        const startIndex = index as number;
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

        // Convert to Markdown string

        const content = treeNodeToString(contentNodes);

        // Create custom node
        const customNode = {
          data: {
            hChildren: [{ type: 'text', value: content }],
            hName: tag,
          },
          position: node.position,
          type: `${tag}Block`,
        };

        // Replace the original nodes
        parent.children.splice(startIndex, deleteCount, customNode);

        // Skip already-processed nodes
        return [SKIP, startIndex + 1];
      }
    });
  };
};
