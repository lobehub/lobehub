import { SKIP, visit } from 'unist-util-visit';

import { AGENTS_TAG } from '@/const/plugin';

const attributeRegex = /(\w+)=["']([^"']*)["']/g;

function parseAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  let match;
  attributeRegex.lastIndex = 0;
  while ((match = attributeRegex.exec(raw)) !== null) {
    attributes[match[1]] = match[2];
  }
  return attributes;
}

function rehypeLobeAgents() {
  return (tree: any) => {
    visit(tree, (node, index, parent) => {
      // Handle <lobeAgents .../> wrapped inside a <p> element
      if (node.type === 'element' && node.tagName === 'p' && node.children.length > 0) {
        const firstChild = node.children[0];
        if (firstChild.type === 'raw' && firstChild.value.startsWith(`<${AGENTS_TAG}`)) {
          const newNode = {
            children: [],
            properties: parseAttributes(firstChild.value),
            tagName: AGENTS_TAG,
            type: 'element',
          };

          // P1 fix: preserve any trailing siblings in the paragraph
          const remainingChildren = node.children.slice(1).filter(
            (c: any) => !(c.type === 'raw' && c.value.startsWith('</')),
          );

          if (remainingChildren.length > 0) {
            const remainingP = { ...node, children: remainingChildren };
            parent.children.splice(index, 1, newNode, remainingP);
          } else {
            parent.children.splice(index, 1, newNode);
          }
          return [SKIP, index];
        }
      }
      // Handle bare <lobeAgents .../> raw node (self-closing or opening tag)
      else if (node.type === 'raw' && node.value.startsWith(`<${AGENTS_TAG}`)) {
        const newNode = {
          children: [],
          properties: parseAttributes(node.value),
          tagName: AGENTS_TAG,
          type: 'element',
        };

        parent.children.splice(index, 1, newNode);
        return [SKIP, index];
      }
    });
  };
}

export default rehypeLobeAgents;
