import type { IEditor } from '@lobehub/editor';
import { CommonPlugin, Kernel, MarkdownPlugin, moment } from '@lobehub/editor';
import { $createParagraphNode, $createTextNode, $getRoot, $getSelection } from 'lexical';
import { describe, expect, it } from 'vitest';

import { $appendQuote, getQuoteLines } from './quote';

const createEditor = () => {
  const editor = new Kernel() as unknown as IEditor;
  editor.registerPlugins([CommonPlugin, MarkdownPlugin]);
  editor.initNodeEditor();
  return editor;
};

const run = async (editor: IEditor, fn: () => void) => {
  editor.getLexicalEditor()!.update(fn);
  await moment();
};

const markdown = (editor: IEditor) => String(editor.getDocument('markdown')).trim();

describe('getQuoteLines', () => {
  it('drops surrounding blank lines and trailing spaces but keeps inner blank lines', () => {
    expect(getQuoteLines('\r\n\nfirst  \r\n\nsecond\n\n')).toEqual(['first', '', 'second']);
  });

  it('returns nothing for whitespace', () => {
    expect(getQuoteLines(' \n\t\n')).toEqual([]);
  });
});

describe('$appendQuote', () => {
  it('quotes into an empty draft and leaves the caret on the line after it', async () => {
    const editor = createEditor();
    let caretText: string | undefined;

    await run(editor, () => {
      $getRoot().clear().append($createParagraphNode());
      $appendQuote('line one\nline two');
      caretText = $getSelection()?.getNodes()[0]?.getTextContent();
    });

    expect(markdown(editor)).toMatch(/^> line one\n> line two$/m);
    expect($getRootChildTypes(editor)).toEqual(['quote', 'paragraph']);
    expect(caretText).toBe('');
  });

  it('appends after an existing draft instead of replacing it', async () => {
    const editor = createEditor();

    await run(editor, () => {
      $getRoot()
        .clear()
        .append($createParagraphNode().append($createTextNode('my question')));
      $appendQuote('quoted');
    });

    expect(markdown(editor).startsWith('my question')).toBe(true);
    expect(markdown(editor)).toContain('> quoted');
    expect($getRootChildTypes(editor)).toEqual(['paragraph', 'quote', 'paragraph']);
  });

  it('does nothing for a blank selection', async () => {
    const editor = createEditor();
    let key: string | undefined = 'unset';

    await run(editor, () => {
      $getRoot().clear().append($createParagraphNode());
      key = $appendQuote('  \n ');
    });

    expect(key).toBeUndefined();
    expect($getRootChildTypes(editor)).toEqual(['paragraph']);
  });
});

function $getRootChildTypes(editor: IEditor) {
  return editor
    .getLexicalEditor()!
    .getEditorState()
    .read(() =>
      $getRoot()
        .getChildren()
        .map((node) => node.getType()),
    );
}
