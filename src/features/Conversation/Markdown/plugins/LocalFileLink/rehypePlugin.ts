import { isDesktop } from '@lobechat/const';
import { SKIP, visit } from 'unist-util-visit';

import { LOBE_LOCAL_FILE_LINK_TAG, parseLocalFileHref } from './parse';

const getNodeText = (node: any): string => {
  if (!node) return '';
  if (node.type === 'text') return String(node.value ?? '');
  if (Array.isArray(node.children)) return node.children.map(getNodeText).join('');
  return '';
};

export const rehypeLocalFileLink = () => (tree: any) => {
  if (!isDesktop) return;

  visit(tree, 'element', (node: any) => {
    if (node.tagName !== 'a') return;

    const href = node.properties?.href as string | undefined;
    const parsed = parseLocalFileHref(href);
    if (!parsed) return;

    const text = getNodeText(node).trim();
    const label = text || parsed.filePath.split(/[\\/]/).at(-1) || parsed.filePath;

    node.tagName = LOBE_LOCAL_FILE_LINK_TAG;
    node.children = [];
    node.properties = {
      linkHref: href,
      linkLabel: label,
    };

    return SKIP;
  });
};
