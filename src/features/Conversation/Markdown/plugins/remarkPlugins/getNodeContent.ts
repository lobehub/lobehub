import { toMarkdown } from 'mdast-util-to-markdown';
import type {Parent} from 'unist';

const processNode = (node: any): string => {
  // 处理数学公式节点
  if (node.type === 'inlineMath') {
    return `$${node.value}$`;
  }

  if (node.type === 'link') {
    const text = node.children?.[0] ? processNode(node.children?.[0]) : '';

    return `[${text}](${node.url})`;
  }

  // 处理带有子节点的容器
  if (node.children) {
    const content = node.children.map((element: Parent) => processNode(element)).join('');

    // 处理列表的特殊换行逻辑
    if (node.type === 'list') {
      return `\n${content}\n`;
    }

    // 处理列表项的前缀
    if (node.type === 'listItem') {
      const prefix = node.checked !== null ? `[${node.checked ? 'x' : ' '}] ` : '';
      return `${prefix}${content}`;
    }

    return content;
  }

  // 处理文本节点
  if (node.value) {
    // 保留原始空白字符处理逻辑
    return node.value.replaceAll(/^\s+|\s+$/g, ' ');
  }

  // 兜底使用标准转换
  return toMarkdown(node);
};

export const treeNodeToString = (nodes: Parent[]) => {
  return nodes
    .map((node) => {
      // 处理列表的缩进问题
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
