import { parseMarkdown } from 'chat';
import { visit } from 'unist-util-visit';

/** Read explicit image references, never ordinary links or code examples. */
export const extractFinalReplyImageUrls = (text: string): string[] => {
  const tree = parseMarkdown(text);
  const definitions = new Map<string, string>();
  visit(tree, 'definition', (node) => {
    const id = node.identifier.toUpperCase();
    // CommonMark resolves duplicate definitions to the first definition.
    if (!definitions.has(id)) definitions.set(id, node.url);
  });

  const urls: string[] = [];
  visit(tree, (node) => {
    if (node.type === 'image') urls.push(node.url);
    if (node.type === 'imageReference') {
      const url = definitions.get(node.identifier.toUpperCase());
      if (url) urls.push(url);
    }
  });
  return urls;
};
