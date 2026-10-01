import type { IEditor } from '@lobehub/editor';
import {
  CommonPlugin,
  Kernel,
  ListPlugin,
  LitexmlPlugin,
  MarkdownPlugin,
  moment,
} from '@lobehub/editor';
import { DiffAction, LITEXML_DIFFNODE_ALL_COMMAND } from '@lobehub/editor/litexml-commands';
import { $getRoot, type ElementNode, type TextNode } from 'lexical';
import { describe, expect, it } from 'vitest';

import { normalizeEditorDataDiffNodes } from '../../../../src/libs/editor/normalizeDiffNodes';
import { EditorRuntime } from '../EditorRuntime';
import { diffLiteXMLBlocks } from '../liteXMLBlockDiff';

const setup = async (markdown: string) => {
  const editor = new Kernel() as unknown as IEditor;
  editor.registerPlugins([CommonPlugin, MarkdownPlugin, ListPlugin, LitexmlPlugin]);
  editor.initNodeEditor();
  editor.setDocument('markdown', markdown);
  await moment();

  const runtime = new EditorRuntime();
  runtime.setEditor(editor);
  runtime.setTitleHandlers(
    () => {},
    () => 'Title',
  );

  const xml = () => editor.getDocument('litexml') as unknown as string;
  const markdownOf = () => (editor.getDocument('markdown') as unknown as string).trim();

  const apply = async (edit: (xml: string) => string) => {
    const original = xml();
    const diff = diffLiteXMLBlocks(original, edit(original));
    if (!diff.ok) throw new Error(diff.reason);
    const result = await runtime.modifyNodes({ operations: diff.operations });
    await moment();
    return { diff, result };
  };

  const selectBlock = (index: number) =>
    (editor as any).getLexicalEditor().update(
      () => {
        const text = ($getRoot().getChildren()[index] as ElementNode).getFirstChild() as TextNode;
        text.select(0, text.getTextContentSize());
      },
      { discrete: true },
    );

  const resolve = async (action: DiffAction) => {
    editor.dispatchCommand(LITEXML_DIFFNODE_ALL_COMMAND, { action });
    await moment();
  };

  return {
    apply,
    markdownOf,
    selectBlock,
    xml,
    resolve,
    runtime,
    json: () => editor.getDocument('json'),
  };
};

const topLevelIds = (xml: string) =>
  [...xml.matchAll(/^ {2}<\w+ id="([^"]+)"/gm)].map((match) => match[1]);

describe('diffLiteXMLBlocks against a real editor', () => {
  it.each(['before paragraph', '- first\n- second'])(
    'preserves accepted history while a modification is pending: %s',
    async (markdown) => {
      const page = await setup(markdown);
      const before = page.json();
      await page.apply((xml) => xml.replace(/before|second/, 'changed'));

      expect(
        normalizeEditorDataDiffNodes(page.json() as unknown as Record<string, unknown>),
      ).toEqual(before);
    },
  );

  it.each([DiffAction.Accept, DiffAction.Reject])(
    'keeps a list edit reviewable until action %s',
    async (action) => {
      const before = '- first\n- second\n- third';
      const page = await setup(before);
      const { result } = await page.apply((xml) => xml.replace('second', 'SECOND'));

      expect(result.successCount).toBe(result.totalCount);
      expect(JSON.stringify(page.json())).toContain('"type":"diff"');
      expect(page.markdownOf()).toBe(before.replace('second', 'SECOND'));
      await page.resolve(action);
      expect(JSON.stringify(page.json())).not.toContain('"type":"diff"');
      expect(page.markdownOf()).toBe(
        action === DiffAction.Accept ? before.replace('second', 'SECOND') : before,
      );
    },
  );

  it.each([DiffAction.Accept, DiffAction.Reject])(
    'keeps inserted and removed lists reviewable until action %s',
    async (action) => {
      const page = await setup('intro\n\n- old item\n\ntail');
      const before = page.markdownOf();
      const { result } = await page.apply((xml) =>
        xml
          .replace(/<ul\b[^>]*>[\s\S]*?<\/ul>/, '')
          .replace('</root>', '<ol><li>new item</li><li>next item</li></ol></root>'),
      );

      expect(result.successCount).toBe(result.totalCount);
      expect(JSON.stringify(page.json())).toContain('"diffType":"remove"');
      expect(JSON.stringify(page.json())).toContain('"diffType":"add"');
      await page.resolve(action);
      expect(JSON.stringify(page.json())).not.toContain('"type":"diff"');
      expect(page.markdownOf()).toBe(
        action === DiffAction.Accept ? 'intro\n\ntail\n\n1. new item\n2. next item' : before,
      );
    },
  );

  it.each([DiffAction.Accept, DiffAction.Reject])(
    'preserves nested list structure when resolving action %s',
    async (action) => {
      const page = await setup('- parent\n    - nested\n- tail');
      const before = page.markdownOf();
      const { result } = await page.apply((xml) => xml.replace('nested', 'NESTED'));
      expect(result.successCount).toBe(result.totalCount);
      await page.resolve(action);
      expect(page.markdownOf()).toBe(
        action === DiffAction.Accept ? before.replace('nested', 'NESTED') : before,
      );
    },
  );

  it.each(['beforeId', 'afterId'] as const)(
    'can reject a list item inserted using %s without an empty bullet',
    async (anchor) => {
      const page = await setup('- first\n- second');
      const before = page.markdownOf();
      const id = page.xml().match(/<li id="([^"]+)"/)![1];
      const result = await page.runtime.modifyNodes({
        operations: [
          {
            action: 'insert',
            ...(anchor === 'beforeId' ? { beforeId: id } : { afterId: id }),
            litexml: '<li>added</li>',
          },
        ],
      });
      expect(result.successCount).toBe(1);
      expect(page.markdownOf()).toContain('- added');
      await page.resolve(DiffAction.Reject);
      expect(page.markdownOf()).toBe(before);
    },
  );

  it.each([DiffAction.Accept, DiffAction.Reject])(
    'can review a directly targeted list item with action %s',
    async (action) => {
      const page = await setup('- first\n- second');
      const before = page.markdownOf();
      const id = page.xml().match(/<li id="([^"]+)"/)![1];
      const result = await page.runtime.modifyNodes({
        operations: [{ action: 'modify', litexml: `<li id="${id}">FIRST</li>` }],
      });
      expect(result.successCount).toBe(1);
      expect(JSON.stringify(page.json())).toContain('"type":"diff"');
      await page.resolve(action);
      expect(page.markdownOf()).toBe(
        action === DiffAction.Accept ? before.replace('first', 'FIRST') : before,
      );
    },
  );

  it('restores the original list when a pending modification is deleted and rejected', async () => {
    const page = await setup('intro\n\n- first\n- second\n\ntail');
    const before = page.markdownOf();
    await page.apply((xml) => xml.replace('second', 'SECOND'));
    await page.apply((xml) => xml.replace(/<ul\b[^>]*>[\s\S]*?<\/ul>/, ''));
    await page.resolve(DiffAction.Reject);

    expect(page.markdownOf()).toBe(before);
    expect(page.json()).toMatchObject({
      root: { children: [{ type: 'paragraph' }, { type: 'list' }, { type: 'paragraph' }] },
    });
  });
  it('applies an in-place text edit as a single modify without whitespace artifacts', async () => {
    const page = await setup('para one\n\npara two\n\npara three\n');
    const [first, , third] = topLevelIds(page.xml());

    const { result } = await page.apply((xml) => xml.replace('para two', 'para TWO'));

    expect(result.successCount).toBe(result.totalCount);
    expect(page.markdownOf()).toBe('para one\n\npara TWO\n\npara three');
    expect(topLevelIds(page.xml())).toEqual(expect.arrayContaining([first, third]));
  });

  it('appends new blocks at the end in order', async () => {
    const page = await setup('para one\n\npara two\n');

    const { result } = await page.apply((xml) =>
      xml.replace('</root>', '<h2>Next</h2><p>tail one</p><p>tail two</p></root>'),
    );

    expect(result.successCount).toBe(result.totalCount);
    expect(page.markdownOf()).toBe('para one\n\npara two\n\n## Next\n\ntail one\n\ntail two');
  });

  it('inserts after a block that the same batch modifies', async () => {
    const page = await setup('para one\n\npara two\n');

    const { result } = await page.apply((xml) =>
      xml.replace(
        /(<p id="[^"]+">\s*<span id="[^"]+">)para one(<\/span>\s*<\/p>)/,
        '$1para ONE$2<p>between</p>',
      ),
    );

    expect(result.successCount).toBe(result.totalCount);
    expect(page.markdownOf()).toBe('para ONE\n\nbetween\n\npara two');
  });

  it('inserts after a block that the same batch removes', async () => {
    const page = await setup('para one\n\npara two\n\npara three\n');

    const { result } = await page.apply((xml) =>
      xml.replace(
        /<p id="[^"]+">\s*<span id="[^"]+">para two<\/span>\s*<\/p>/,
        '<p>replacement</p>',
      ),
    );

    expect(result.successCount).toBe(result.totalCount);
    expect(page.markdownOf()).toBe('para one\n\nreplacement\n\npara three');
  });

  it('moves a block', async () => {
    const page = await setup('para one\n\npara two\n\npara three\n');

    const { result } = await page.apply((xml) => {
      const blocks = [...xml.matchAll(/ {2}<p id="[^"]+">[\s\S]*?<\/p>/g)].map((match) => match[0]);
      return `<root>${blocks[0]}${blocks[2]}${blocks[1]}</root>`;
    });

    expect(result.successCount).toBe(result.totalCount);
    expect(page.markdownOf()).toBe('para one\n\npara three\n\npara two');
  });

  it('keeps the spaces between formatted runs when a paragraph is edited', async () => {
    const page = await setup('**bold** *ital* tail\n');

    const { result } = await page.apply((xml) => xml.replace('tail', 'TAIL'));

    expect(result.successCount).toBe(result.totalCount);
    expect(page.markdownOf()).toBe('**bold** *ital* TAIL');
  });

  it('keeps the spaces between formatted runs in a newly written block', async () => {
    const page = await setup('para one\n');

    const { result } = await page.apply((xml) =>
      xml.replace('</root>', '<p>This is <b>bold</b> <i>ital</i> end</p></root>'),
    );

    expect(result.successCount).toBe(result.totalCount);
    expect(page.markdownOf()).toBe('para one\n\nThis is **bold** *ital* end');
  });

  it('edits a page whose text contains unescaped angle brackets', async () => {
    const page = await setup('use a<b and c>d\n\nplain\n');

    const { result } = await page.apply((xml) => xml.replace('plain', 'PLAIN'));

    expect(result.successCount).toBe(result.totalCount);
    expect(page.markdownOf()).toContain('PLAIN');
  });

  it('edits a paragraph that itself contains angle brackets and ampersands', async () => {
    const page = await setup('AT&T says a<b and c>d tail\n');

    const { result } = await page.apply((xml) => xml.replace('tail', 'TAIL'));

    expect(result.successCount).toBe(result.totalCount);
    expect(page.xml()).toContain('AT&T says a');
    expect(page.xml()).toContain('<b and c>');
    expect(page.xml()).toContain('d TAIL');
  });

  it('edits a block that the user currently has selected', async () => {
    const page = await setup('para one\n\npara two\n');
    page.selectBlock(1);

    const { result } = await page.apply((xml) => xml.replace('para two', 'para TWO'));

    expect(result.successCount).toBe(result.totalCount);
    expect(page.markdownOf()).toBe('para one\n\npara TWO');
  });

  it('edits again while an earlier edit is still pending review', async () => {
    const page = await setup('para one\n\npara two\n\npara three\n');
    await page.apply((xml) => xml.replace('para one', 'para ONE'));

    const { result } = await page.apply((xml) => xml.replace('para three', 'para THREE'));

    expect(result.successCount).toBe(result.totalCount);
    expect(page.markdownOf()).toBe('para ONE\n\npara two\n\npara THREE');
  });
});
