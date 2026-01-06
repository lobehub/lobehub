import { SKIP, visit } from 'unist-util-visit';

import { ARTIFACT_TAG } from '@/const/plugin';

function rehypeAntArtifact() {
  return (tree: any) => {
    visit(tree, (node, index, parent) => {
      if (node.type === 'element' && node.tagName === 'p' && node.children.length > 0) {
        const firstChild = node.children[0];
        if (firstChild.type === 'raw' && firstChild.value.startsWith(`<${ARTIFACT_TAG}`)) {
          // 提取 lobeArtifact 的属性
          const attributes: Record<string, string> = {};
          const attributeRegex = /(\w+)="([^"]*)"/g;
          let match;
          while ((match = attributeRegex.exec(firstChild.value)) !== null) {
            attributes[match[1]] = match[2];
          }

          // 创建新的 lobeArtifact 节点
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

          // 替换原来的 p 节点
          parent.children.splice(index, 1, newNode);
          return [SKIP, index];
        }
      }
      // 如果字符串是 <lobeArtifact identifier="ai-new-interpretation" type="image/svg+xml" title="人工智能新解释">
      // 得到的节点就是：
      // {
      //   type: 'raw',
      //   value:
      //     '<lobeArtifact identifier="ai-new-interpretation" type="image/svg+xml" title="人工智能新解释">',
      // }
      else if (node.type === 'raw' && node.value.startsWith(`<${ARTIFACT_TAG}`)) {
        // 创建新的 lobeArtifact 节点
        const newNode = {
          children: [],
          properties: {},
          tagName: ARTIFACT_TAG,
          type: 'element',
        };

        // 替换原来的 p 节点
        parent.children.splice(index, 1, newNode);
        return [SKIP, index];
      }
    });
  };
}

export default rehypeAntArtifact;
