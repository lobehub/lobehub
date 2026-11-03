import { toMarkdown } from 'mdast-util-to-markdown';
import { type Parent } from 'unist';

const processNode = (node: any): string => {
  // Handle math formula nodes
  if (node.type === 'inlineMath') {
    return `$${node.value}$`;
  }

  if (node.type === 'link') {
    const text = node.children?.[0] ? processNode(node.children?.[0]) : '';

    return `[${text}](${node.url})`;
  }

  // Handle containers with child nodes
  if (node.children) {
    const content = node.children.map((element: Parent) => processNode(element)).join('');

    // Handle special line-break logic for lists
    if (node.type === 'list') {
      return `\n${content}\n`;
    }

    // Handle list item prefixes
    if (node.type === 'listItem') {
      const prefix = node.checked !== null ? `[${node.checked ? 'x' : ' '}] ` : '';
      return `${prefix}${content}`;
    }

    return content;
  }

  // Handle text nodes
  if (node.value) {
    // Preserve original whitespace handling logic
    return node.value.replaceAll(/^\s+|\s+$/g, ' ');
  }

  // Fall back to standard conversion
  return toMarkdown(node);
};

export const treeNodeToString = (nodes: Parent[]) => {
  return nodes
    .map((node) => {
      // Handle list indentation
      if (node.type === 'list') {
        return node.children
          .map((item, index) => {
            const prefix = (node as any).ordered ? `${(node as any).start + index}. ` : '- ';
            return `${prefix}${processNode(item)}`;
          })
          .join('\n');
      }

      return processNode(node);
    })
    .join('\n\n')
    .trim();
};
