import { SKIP, visit } from 'unist-util-visit';

import { treeNodeToString } from './getNodeContent';

export interface RemarkCustomTagOptions {
  /**
   * Only parse the tag when it is the very first node of the document. Tags
   * appearing mid-document — including inline ones inside a paragraph — stay
   * as raw HTML / plain text instead of becoming a custom block.
   */
  leadingOnly?: boolean;
}

export const createRemarkCustomTagPlugin =
  (tag: string, options: RemarkCustomTagOptions = {}) =>
  () => {
    const leadingOnly = options.leadingOnly === true;

    return (tree: any) => {
      visit(tree, 'html', (node, index, parent) => {
        if (leadingOnly) {
          // Leading-only mode (e.g. the `think` tag): the tag is a leading block,
          // not an inline construct. Only an exact standalone open tag sitting at
          // the very head of the document is eligible — anything else (inline tag
          // inside a paragraph, or a block tag after other content) must stay raw
          // HTML so quoting `<think>` mid-message never renders a Thinking block.
          if (parent?.type !== 'root' || index !== 0) return;
          if (node.value !== `<${tag}>`) return;
        } else if (node.value !== `<${tag}>`) {
          return;
        }

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
      });
    };
  };
