import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';

import { createRemarkSelfClosingTagPlugin } from './createRemarkSelfClosingTagPlugin';

// Helper function to process markdown and get the resulting tree
const processMarkdown = (markdown: string, tagName: string) => {
  const processor = unified().use(remarkParse).use(createRemarkSelfClosingTagPlugin(tagName));

  const tree = processor.parse(markdown);
  return processor.runSync(tree);
};

describe('createRemarkSelfClosingTagPlugin', () => {
  const tagName = 'localFile';

  const collectNodesByType = (tree: any, type: string) => {
    const nodes: any[] = [];
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === type) nodes.push(node);
      const children = (node as any).children;
      if (Array.isArray(children)) for (const child of children) walk(child);
    };
    walk(tree);
    return nodes;
  };

  it('should replace a single self-closing tag (parsed as HTML) with a custom node', () => {
    const markdown = `<${tagName} name="test.txt" path="/path/to/test.txt" />`;
    const tree = processMarkdown(markdown, tagName);

    expect(tree.children).toHaveLength(1);
    const node = tree.children[0];
    expect(node.type).toBe(tagName);
    expect(node.data?.hProperties).toEqual({
      name: 'test.txt',
      path: '/path/to/test.txt',
    });
    expect(node.data?.hName).toBe(tagName);
  });

  it('should handle boolean attributes in a standalone tag', () => {
    const markdown = `<${tagName} name="docs" path="/path/to/docs" isDirectory />`;
    const tree = processMarkdown(markdown, tagName);

    expect(tree.children).toHaveLength(1);
    const node = tree.children[0];
    expect(node.type).toBe(tagName);
    expect(node.data?.hProperties).toEqual({
      name: 'docs',
      path: '/path/to/docs',
      isDirectory: true,
    });
    expect(node.data?.hName).toBe(tagName);
  });

  it('should handle tags surrounded by text (parsed within paragraph)', () => {
    const markdown = `Here is a file: <${tagName} name="report.pdf" path="report.pdf" /> Please review.`;
    const tree = processMarkdown(markdown, tagName);

    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].type).toBe('paragraph');

    const paragraphChildren = tree.children[0].children;
    expect(paragraphChildren).toHaveLength(3);

    expect(paragraphChildren[0].type).toBe('text');
    expect(paragraphChildren[0].value).toBe('Here is a file: ');

    const tagNode = paragraphChildren[1];
    expect(tagNode.type).toBe(tagName);
    expect(tagNode.data?.hProperties).toEqual({
      name: 'report.pdf',
      path: 'report.pdf',
    });
    expect(tagNode.data?.hName).toBe(tagName);

    expect(paragraphChildren[2].type).toBe('text');
    expect(paragraphChildren[2].value).toBe(' Please review.');
  });

  it('should handle multiple tags within the same text block', () => {
    const markdown = `File 1: <${tagName} name="a.txt" path="a" /> and File 2: <${tagName} name="b.txt" path="b" isDirectory />`;
    const tree = processMarkdown(markdown, tagName);

    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].type).toBe('paragraph');

    const paragraphChildren = tree.children[0].children;
    expect(paragraphChildren).toHaveLength(4);

    expect(paragraphChildren[0].value).toBe('File 1: ');

    const tagNode1 = paragraphChildren[1];
    expect(tagNode1.type).toBe(tagName);
    expect(tagNode1.data?.hProperties).toEqual({ name: 'a.txt', path: 'a' });
    expect(tagNode1.data?.hName).toBe(tagName);

    expect(paragraphChildren[2].value).toBe(' and File 2: ');

    const tagNode2 = paragraphChildren[3];
    expect(tagNode2.type).toBe(tagName);
    expect(tagNode2.data?.hProperties).toEqual({
      name: 'b.txt',
      path: 'b',
      isDirectory: true,
    });
    expect(tagNode2.data?.hName).toBe(tagName);
  });

  it('should handle standalone tags with no attributes', () => {
    const markdown = `<${tagName} />`;
    const tree = processMarkdown(markdown, tagName);

    expect(tree.children).toHaveLength(1);
    const node = tree.children[0];
    expect(node.type).toBe(tagName);
    expect(node.data?.hProperties).toEqual({});
    expect(node.data?.hName).toBe(tagName);
  });

  it('should ignore tags with different names (parsed within a paragraph)', () => {
    const markdown = `<other_tag name="ignore_me" /> <${tagName} name="process_me" path="/p" />`;
    const tree = processMarkdown(markdown, tagName);

    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].type).toBe('paragraph');

    const paragraphChildren = tree.children[0].children;
    expect(paragraphChildren).toHaveLength(2);

    expect(paragraphChildren[0].type).toBe('text');
    expect(paragraphChildren[0].value).toBe('<other_tag name="ignore_me" /> ');

    const tagNode = paragraphChildren[1];
    expect(tagNode.type).toBe(tagName);
    expect(tagNode.data?.hProperties).toEqual({ name: 'process_me', path: '/p' });
    expect(tagNode.data?.hName).toBe(tagName);
  });

  it('should not modify markdown without the target tag', () => {
    const markdown = 'This is just regular text.';
    const tree = processMarkdown(markdown, tagName);
    const originalTree = unified().use(remarkParse).parse(markdown);

    expect(tree).toEqual(originalTree);
  });

  it('should work with a different tag name provided to the creator', () => {
    const otherTagName = 'customData';
    const markdown = `Data: <${otherTagName} id="123" value="abc" active />`;
    const tree = processMarkdown(markdown, otherTagName);

    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].type).toBe('paragraph');
    const paragraphChildren = tree.children[0].children;
    expect(paragraphChildren).toHaveLength(2);

    expect(paragraphChildren[0].value).toBe('Data: ');

    const tagNode = paragraphChildren[1];
    expect(tagNode.type).toBe(otherTagName);
    expect(tagNode.data?.hProperties).toEqual({ id: '123', value: 'abc', active: true });
    expect(tagNode.data?.hName).toBe(otherTagName);
  });

  it('should handle tag at the beginning of the text', () => {
    const markdown = `<${tagName} name="start.log" path="/logs/start.log" /> Log started.`;
    const tree = processMarkdown(markdown, tagName);

    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].type).toBe('paragraph');
    const paragraphChildren = tree.children[0].children;
    expect(paragraphChildren).toHaveLength(2);

    const tagNode = paragraphChildren[0];
    expect(tagNode.type).toBe(tagName);
    expect(tagNode.data?.hProperties).toEqual({ name: 'start.log', path: '/logs/start.log' });
    expect(tagNode.data?.hName).toBe(tagName);

    expect(paragraphChildren[1].type).toBe('text');
    expect(paragraphChildren[1].value).toBe(' Log started.');
  });

  it('should handle tag at the end of the text', () => {
    const markdown = `Log ended: <${tagName} name="end.log" path="/logs/end.log" />`;
    const tree = processMarkdown(markdown, tagName);

    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].type).toBe('paragraph');
    const paragraphChildren = tree.children[0].children;
    expect(paragraphChildren).toHaveLength(2);

    expect(paragraphChildren[0].type).toBe('text');
    expect(paragraphChildren[0].value).toBe('Log ended: ');

    const tagNode = paragraphChildren[1];
    expect(tagNode.type).toBe(tagName);
    expect(tagNode.data?.hProperties).toEqual({ name: 'end.log', path: '/logs/end.log' });
    expect(tagNode.data?.hName).toBe(tagName);
  });

  it('should handle tag within a list item and generate snapshot', () => {
    const markdown = `
1. 文件名：飞机全书 一部明晰可见的历史.pdf
   - 路径1：<${tagName} name="飞机全书 一部明晰可见的历史.pdf" path="/Users/abc/Zotero/storage/ASBMAURK/飞机全书 一部明晰可见的历史.pdf" />
   - 路径2：/Users/abc/Downloads/测试 PDF/飞机全书 一部明晰可见的历史.pdf

这是一本 PDF 格式的书，并且在你的 Zotero 和 Downloads 文件夹里都能找到。如果需要进一步操作，比如阅读或者提取内容，可以告诉我
`;
    const tree = processMarkdown(markdown, tagName);
    expect(tree).toMatchSnapshot();
  });

  it('should parse attributes containing spaces and @ (real-world screenshot file name)', () => {
    const markdown = `<${tagName} name="CleanShot 2025-12-17 at 17.56.33@2x.jpg" path="/Users/innei/Desktop/CleanShot 2025-12-17 at 17.56.33@2x.jpg" />`;
    const tree = processMarkdown(markdown, tagName);

    expect(tree.children).toHaveLength(1);
    const node = tree.children[0];
    expect(node.type).toBe(tagName);
    expect(node.data?.hName).toBe(tagName);
    expect(node.data?.hProperties).toEqual({
      name: 'CleanShot 2025-12-17 at 17.56.33@2x.jpg',
      path: '/Users/innei/Desktop/CleanShot 2025-12-17 at 17.56.33@2x.jpg',
    });
  });

  it('should handle multiple consecutive tags parsed as a single html block node', () => {
    const markdown = [
      '以下是桌面（`<localFile name="Desktop" path="/Users/innei/Desktop" isDirectory />`）下的文件列表：',
      '',
      '<localFile name="CleanShot 2025-12-17 at 17.56.33@2x.jpg" path="/Users/innei/Desktop/CleanShot 2025-12-17 at 17.56.33@2x.jpg" />',
      '<localFile name="CleanShot 2025-12-17 at 17.56.39@2x.jpg" path="/Users/innei/Desktop/CleanShot 2025-12-17 at 17.56.39@2x.jpg" />',
      '<localFile name="CleanShot 2025-12-17 at 21.49.12@2x.jpg" path="/Users/innei/Desktop/CleanShot 2025-12-17 at 21.49.12@2x.jpg" />',
      '<localFile name="CleanShot 2025-12-17 at 22.04.01@2x.jpg" path="/Users/innei/Desktop/CleanShot 2025-12-17 at 22.04.01@2x.jpg" />',
      '<localFile name="CleanShot 2025-12-17 at 22.07.37@2x.jpg" path="/Users/innei/Desktop/CleanShot 2025-12-17 at 22.07.37@2x.jpg" />',
      '<localFile name="CleanShot 2025-12-17 at 22.39.37.mp4" path="/Users/innei/Desktop/CleanShot 2025-12-17 at 22.39.37.mp4" />',
      '<localFile name="CleanShot 2025-12-18 at 10.36.19@2x.jpg" path="/Users/innei/Desktop/CleanShot 2025-12-18 at 10.36.19@2x.jpg" />',
      '',
      '如果你想查看其他目录或进一步筛选文件，请告诉我！',
    ].join('\n');

    const tree = processMarkdown(markdown, tagName);
    const localFiles = collectNodesByType(tree, tagName);

    expect(localFiles).toHaveLength(8);
    expect(localFiles.map((n) => n.data?.hProperties?.name)).toEqual([
      'Desktop',
      'CleanShot 2025-12-17 at 17.56.33@2x.jpg',
      'CleanShot 2025-12-17 at 17.56.39@2x.jpg',
      'CleanShot 2025-12-17 at 21.49.12@2x.jpg',
      'CleanShot 2025-12-17 at 22.04.01@2x.jpg',
      'CleanShot 2025-12-17 at 22.07.37@2x.jpg',
      'CleanShot 2025-12-17 at 22.39.37.mp4',
      'CleanShot 2025-12-18 at 10.36.19@2x.jpg',
    ]);
  });

  it('should match tag name in a case-insensitive way (HTML tag names are case-insensitive)', () => {
    const markdown = `<localfile name="a.txt" path="/tmp/a.txt" />`;
    const tree = processMarkdown(markdown, tagName);

    expect(tree.children).toHaveLength(1);
    const node = tree.children[0];
    expect(node.type).toBe(tagName);
    expect(node.data?.hProperties).toEqual({
      name: 'a.txt',
      path: '/tmp/a.txt',
    });
  });

  it('should handle multiple tags in unordered list with directories and files', () => {
    const markdown = [
      '我已查看了你桌面上 test 文件夹的目录，里面包含以下项目：',
      '',
      '- <localFile name=".config" path="/Users/user/Desktop/test/.config" isDirectory />    ', // 注意：行尾有 4 个空格
      '- <localFile name=".venv" path="/Users/user/Desktop/test/.venv" isDirectory />',
    ].join('\n');
    const tree = processMarkdown(markdown, tagName);

    // Should have 2 children: a paragraph and a list
    expect(tree.children).toHaveLength(2);

    // First child should be the introductory paragraph
    expect(tree.children[0].type).toBe('paragraph');

    // Second child should be the unordered list
    const listNode = tree.children[1];
    expect(listNode.type).toBe('list');
    expect(listNode.ordered).toBe(false);

    // The list should have 2 items
    expect(listNode.children).toHaveLength(2);

    // Verify first item (.config directory) - this one has trailing spaces after />
    // When a tag is standalone in a list item, remark doesn't wrap it in a paragraph
    const firstItem = listNode.children[0];
    expect(firstItem.type).toBe('listItem');
    const firstTag = firstItem.children[0];
    expect(firstTag.type).toBe(tagName);
    expect(firstTag.data?.hProperties).toEqual({
      name: '.config',
      path: '/Users/user/Desktop/test/.config',
      isDirectory: true,
    });

    // Verify second item (.venv directory)
    const secondItem = listNode.children[1];
    const secondTag = secondItem.children[0];
    expect(secondTag.type).toBe(tagName);
    expect(secondTag.data?.hProperties).toEqual({
      name: '.venv',
      path: '/Users/user/Desktop/test/.venv',
      isDirectory: true,
    });

    expect(tree).toMatchSnapshot();
  });

  it('should handle tags wrapped in backticks (code)', () => {
    const markdown = `Use this file: \`<${tagName} name="config.json" path="/app/config.json" />\` in your code.`;
    const tree = processMarkdown(markdown, tagName);

    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].type).toBe('paragraph');

    const paragraphChildren = tree.children[0].children;
    expect(paragraphChildren).toHaveLength(3);

    expect(paragraphChildren[0].type).toBe('text');
    expect(paragraphChildren[0].value).toBe('Use this file: ');

    // The tag should be parsed even inside backticks
    const tagNode = paragraphChildren[1];
    expect(tagNode.type).toBe(tagName);
    expect(tagNode.data?.hProperties).toEqual({
      name: 'config.json',
      path: '/app/config.json',
    });

    expect(paragraphChildren[2].type).toBe('text');
    expect(paragraphChildren[2].value).toBe(' in your code.');
  });
});
