import type { IEditor } from '@lobehub/editor';
import {
  CommonPlugin,
  Kernel,
  ListPlugin,
  LitexmlPlugin,
  MarkdownPlugin,
  moment,
} from '@lobehub/editor';
import { $getRoot, type ElementNode, type TextNode } from 'lexical';
import { describe, expect, it } from 'vitest';

import { parseLiteXMLBlocks } from '../liteXMLBlockDiff';
import { getSelectedBlocksLiteXML } from '../selectionLiteXML';

const setup = async (markdown: string) => {
  const editor = new Kernel() as unknown as IEditor;
  editor.registerPlugins([CommonPlugin, MarkdownPlugin, ListPlugin, LitexmlPlugin]);
  editor.initNodeEditor();
  editor.setDocument('markdown', markdown);
  await moment();

  const lexical = (editor as any).getLexicalEditor();
  const textOf = (index: number) =>
    ($getRoot().getChildren()[index] as ElementNode).getFirstChild() as TextNode;
  const blocks = () => {
    const parsed = parseLiteXMLBlocks(editor.getDocument('litexml') as unknown as string);
    if (typeof parsed === 'string') throw new Error(parsed);
    return parsed;
  };

  return { blocks, editor, lexical, textOf };
};

describe('getSelectedBlocksLiteXML', () => {
  it('returns the whole block around a partial selection with the page ids', async () => {
    const page = await setup('para one\n\npara two has more words\n');
    page.lexical.update(() => page.textOf(1).select(5, 8), { discrete: true });

    const xml = getSelectedBlocksLiteXML(page.editor);

    const block = page.blocks()[1];
    expect(xml).toContain(`id="${block.id}"`);
    expect(xml?.replaceAll(/\s+/g, '')).toBe(`<root>${block.xml}</root>`.replaceAll(/\s+/g, ''));
  });

  it('returns every block a selection spans, in order', async () => {
    const page = await setup('para one\n\npara two\n\npara three\n');
    page.lexical.update(
      () => {
        const selection = page.textOf(0).select(2, 2);
        selection.focus.set(page.textOf(1).getKey(), 3, 'text');
      },
      { discrete: true },
    );

    const xml = getSelectedBlocksLiteXML(page.editor) ?? '';

    const [first, second, third] = page.blocks();
    expect(xml.indexOf(`id="${first.id}"`)).toBeGreaterThan(-1);
    expect(xml.indexOf(`id="${second.id}"`)).toBeGreaterThan(xml.indexOf(`id="${first.id}"`));
    expect(xml).not.toContain(`id="${third.id}"`);
  });

  it('returns nothing without a selection', async () => {
    const page = await setup('para one\n');

    expect(getSelectedBlocksLiteXML(page.editor)).toBeUndefined();
  });
});
