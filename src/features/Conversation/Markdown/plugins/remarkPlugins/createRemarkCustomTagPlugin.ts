import { SKIP, visit } from 'unist-util-visit';

import { treeNodeToString } from './getNodeContent';

export const createRemarkCustomTagPlugin = (tag: string) => () => {
  return (tree: any) => {
    visit(tree, 'html', (node, index, parent) => {
      if (node.value === `<${tag}>`) {
        const startIndex = index as number;
        let endIndex = startIndex + 1;
        let hasCloseTag = false;

        // 查找闭合标签
        while (endIndex < parent.children.length) {
          const sibling = parent.children[endIndex];
          if (sibling.type === 'html' && sibling.value === `</${tag}>`) {
            hasCloseTag = true;
            break;
          }
          endIndex++;
        }

        // 计算需要删除的节点范围
        const deleteCount = hasCloseTag
          ? endIndex - startIndex + 1
          : parent.children.length - startIndex;

        // 提取内容节点
        const contentNodes = parent.children.slice(
          startIndex + 1,
          hasCloseTag ? endIndex : undefined,
        );

        // 转换为 Markdown 字符串

        const content = treeNodeToString(contentNodes);

        // 创建自定义节点
        const customNode = {
          data: {
            hChildren: [{ type: 'text', value: content }],
            hName: tag,
          },
          position: node.position,
          type: `${tag}Block`,
        };

        // 替换原始节点
        parent.children.splice(startIndex, deleteCount, customNode);

        // 跳过已处理的节点
        return [SKIP, startIndex + 1];
      }
    });
  };
};
