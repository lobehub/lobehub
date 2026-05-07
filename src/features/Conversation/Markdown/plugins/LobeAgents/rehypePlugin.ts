import { SKIP, visit } from 'unist-util-visit';

import { AGENTS_TAG } from '@/const/plugin';

function rehypeLobeAgents() {
  return (tree: any) => {
    visit(tree, (node, index, parent) => {
      // Handle <lobeAgents .../> or <lobeAgents ...> wrapped inside a <p> element
      if (node.type === 'element' && node.tagName === 'p' && node.children.length > 0) {
        const firstChild = node.children[0];
        if (firstChild.type === 'raw' && firstChild.value.startsWith(`<${AGENTS_TAG}`)) {
          const attributes: Record<string, string> = {};
          const attributeRegex = /(\w+)="([^"]*)"/g;
          let match;
          while ((match = attributeRegex.exec(firstChild.value)) !== null) {
            attributes[match[1]] = match[2];
          }

          const newNode = {
            children: [],
            properties: attributes,
            tagName: AGENTS_TAG,
            type: 'element',
          };

          parent.children.splice(index, 1, newNode);
          return [SKIP, index];
        }
      }
      // Handle bare <lobeAgents .../> raw node (self-closing or opening tag)
      else if (node.type === 'raw' && node.value.startsWith(`<${AGENTS_TAG}`)) {
        const attributes: Record<string, string> = {};
        const attributeRegex = /(\w+)="([^"]*)"/g;
        let match;
        while ((match = attributeRegex.exec(node.value)) !== null) {
          attributes[match[1]] = match[2];
        }

        const newNode = {
          children: [],
          properties: attributes,
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
