import { SKIP, visit } from 'unist-util-visit';

import { ARTIFACT_TAG } from '@/const/plugin';

function rehypeAntArtifact() {
  return (tree: any) => {
    visit(tree, (node, index, parent) => {
      if (node.type === 'element' && node.tagName === 'p' && node.children.length > 0) {
        const firstChild = node.children[0];
        if (firstChild.type === 'raw' && firstChild.value.startsWith(`<${ARTIFACT_TAG}`)) {
          // Extract lobeArtifact attributes
          const attributes: Record<string, string> = {};
          const attributeRegex = /(\w+)="([^"]*)"/g;
          let match;
          while ((match = attributeRegex.exec(firstChild.value)) !== null) {
            attributes[match[1]] = match[2];
          }

          // Create new lobeArtifact node
          const newNode = {
            children: [
              {
                type: 'text',
                value: node.children
                  .slice(1, -1)
                  .map((child: any) => {
                    if (child.type === 'raw') {
                      return child.value;
                    } else if (child.type === 'text') {
                      return child.value;
                    } else if (child.type === 'element' && child.tagName === 'a') {
                      return child.children[0].value;
                    }
                    return '';
                  })
                  .join('')
                  .trim(),
              },
            ],
            properties: attributes,
            tagName: ARTIFACT_TAG,
            type: 'element',
          };

          // Replace the original p node
          parent.children.splice(index, 1, newNode);
          return [SKIP, index];
        }
      }
      // If the string is <lobeArtifact identifier="ai-new-interpretation" type="image/svg+xml" title="New AI Interpretation">
      // The resulting node is:
      // {
      //   type: 'raw',
      //   value:
      //     '<lobeArtifact identifier="ai-new-interpretation" type="image/svg+xml" title="New AI Interpretation">',
      // }
      else if (node.type === 'raw' && node.value.startsWith(`<${ARTIFACT_TAG}`)) {
        // Create new lobeArtifact node
        const newNode = {
          children: [],
          properties: {},
          tagName: ARTIFACT_TAG,
          type: 'element',
        };

        // Replace the original p node
        parent.children.splice(index, 1, newNode);
        return [SKIP, index];
      }
    });
  };
}

export default rehypeAntArtifact;
