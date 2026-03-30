import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';

import { createRemarkCustomTagPlugin } from './createRemarkCustomTagPlugin';

const processMarkdown = (
  markdown: string,
  tagName: string,
  options?: Parameters<typeof createRemarkCustomTagPlugin>[1],
) => {
  const processor = unified().use(remarkParse).use(createRemarkCustomTagPlugin(tagName, options));

  const tree = processor.parse(markdown);
  return processor.runSync(tree);
};

const collectNodesByType = (tree: any, type: string) => {
  const nodes: any[] = [];

  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === type) nodes.push(node);

    const { children } = node as { children?: any[] };
    if (!Array.isArray(children)) return;

    for (const child of children) {
      walk(child);
    }
  };

  walk(tree);
  return nodes;
};

describe('createRemarkCustomTagPlugin', () => {
  it('should replace leading think blocks when restricted to leading position', () => {
    const tree = processMarkdown('<think>Thinking</think>\n\nAnswer', 'think', {
      position: 'leading',
    });

    const thinkNodes = collectNodesByType(tree, 'thinkBlock');

    expect(thinkNodes).toHaveLength(1);
    expect(thinkNodes[0].data?.hName).toBe('think');
    expect(thinkNodes[0].data?.hChildren).toEqual([{ type: 'text', value: 'Thinking' }]);
  });

  it('should keep inline literal think tags as regular markdown when restricted to leading position', () => {
    const markdown = 'The model literally prints <think>example</think> in the answer.';
    const tree = processMarkdown(markdown, 'think', { position: 'leading' });
    const root = tree as unknown as { children: Array<{ type: string }> };

    expect(collectNodesByType(tree, 'thinkBlock')).toHaveLength(0);
    expect(root.children[0].type).toBe('paragraph');
  });

  it('should preserve default behavior for non-leading custom tags', () => {
    const markdown = 'Intro <lobeThinking>artifact planning</lobeThinking> outro';
    const tree = processMarkdown(markdown, 'lobeThinking');

    expect(collectNodesByType(tree, 'lobeThinkingBlock')).toHaveLength(1);
  });
});
