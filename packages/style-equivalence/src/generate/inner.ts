import type { InnerNode } from '../plan/inner';

const VOID_TAGS = new Set(['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'source', 'wbr']);

export const innerMarkup = (nodes: InnerNode[] | undefined, text: string): string =>
  (nodes ?? [])
    .map((node) => {
      const open = `<${node.tag} data-synthetic-inner="" {...${JSON.stringify(node.attributes)}}`;
      if (VOID_TAGS.has(node.tag)) return `${open} />`;
      const content = node.children.length
        ? innerMarkup(node.children, text)
        : `{${JSON.stringify(text)}}`;
      return `${open}>${content}</${node.tag}>`;
    })
    .join('');
