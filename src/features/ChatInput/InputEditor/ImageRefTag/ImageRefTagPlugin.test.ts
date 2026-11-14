import { $dfs } from '@lexical/utils';
import type { IEditor } from '@lobehub/editor';
import { CommonPlugin, Kernel, MarkdownPlugin, moment } from '@lobehub/editor';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { describe, expect, it, vi } from 'vitest';

import type { ImageUploadRef } from '../../utils/imageUploads';
import { $isImageRefTagNode, type ImageRefTagNode } from './ImageRefTagNode';
import { ImageRefTagPlugin, SYNC_IMAGE_REF_TAGS_COMMAND } from './ImageRefTagPlugin';

const createEditor = (decorator: (node: ImageRefTagNode) => unknown = () => null) => {
  const editor = new Kernel() as unknown as IEditor;
  editor.registerPlugins([CommonPlugin, MarkdownPlugin]);
  editor.registerPlugin(ImageRefTagPlugin, { decorator });
  editor.initNodeEditor();
  return editor;
};

const refsOf = (...srcs: string[]) =>
  new Map<string, ImageUploadRef>(srcs.map((src, index) => [src, { number: index + 1, src }]));

const sync = async (
  editor: IEditor,
  refs: Map<string, ImageUploadRef>,
  { insert, removed }: { insert?: string[]; removed?: string[] } = {},
) => {
  editor.dispatchCommand(SYNC_IMAGE_REF_TAGS_COMMAND, { insert, refs, removed });
  await moment();
};

// The exported markdown escapes `[`, which still reads as the literal text `[Image #N]`.
const markdown = (editor: IEditor) =>
  String(editor.getDocument('markdown')).trim().replaceAll('\\[', '[');

const setText = async (editor: IEditor, text: string) => {
  editor.getLexicalEditor()!.update(() => {
    const paragraph = $createParagraphNode().append($createTextNode(text));
    $getRoot().clear().append(paragraph);
    paragraph.selectEnd();
  });
  await moment();
};

describe('ImageRefTagPlugin', () => {
  it('renders each reference through the registered decorator', async () => {
    const decorator = vi.fn((node: ImageRefTagNode) => `chip ${node.number}`);
    const editor = createEditor(decorator);
    await setText(editor, '');
    await sync(editor, refsOf('blob:a'), { insert: ['blob:a'] });

    const lexical = editor.getLexicalEditor()!;
    const rendered = lexical.getEditorState().read(() =>
      $dfs()
        .map(({ node }) => node)
        .filter($isImageRefTagNode)
        .map((node) => node.decorate(lexical)),
    );

    expect(rendered).toEqual(['chip 1']);
  });

  it('references newly attached images at the caret as [Image #N]', async () => {
    const editor = createEditor();
    await setText(editor, 'compare');

    await sync(editor, refsOf('blob:a', 'blob:b'), { insert: ['blob:a', 'blob:b'] });

    expect(markdown(editor)).toBe('compare[Image #1] [Image #2]');
  });

  it('renumbers references when an earlier image is removed', async () => {
    const editor = createEditor();
    await setText(editor, 'see ');
    await sync(editor, refsOf('blob:a', 'blob:b'), { insert: ['blob:a', 'blob:b'] });

    await sync(editor, refsOf('blob:b'), { removed: ['blob:a'] });

    expect(markdown(editor)).toBe('see [Image #1]');
  });

  it('removes references to images that are no longer attached', async () => {
    const editor = createEditor();
    await setText(editor, 'look ');
    await sync(editor, refsOf('blob:a'), { insert: ['blob:a'] });

    await sync(editor, refsOf(), { removed: ['blob:a'] });

    expect(markdown(editor)).toBe('look');
  });

  it('leaves references to unlisted images out of the text, even after undo', async () => {
    const editor = createEditor();
    await setText(editor, 'a ');
    await sync(editor, refsOf('blob:a', 'blob:b'), { insert: ['blob:a', 'blob:b'] });
    const beforeRemoval = editor.getDocument('json');

    // Removing image #1 and then undoing brings its reference and the old numbers back.
    await sync(editor, refsOf('blob:b'), { removed: ['blob:a'] });
    editor.setDocument('json', beforeRemoval);
    await moment();

    // The removed image's reference writes nothing; only its trailing space remains.
    expect(markdown(editor).replaceAll(/\s+/g, ' ')).toBe('a [Image #1]');
  });

  it('keeps a restored reference whose image is not listed yet', async () => {
    const editor = createEditor();
    await setText(editor, 'old ');
    await sync(editor, refsOf('blob:a'), { insert: ['blob:a'] });
    const restored = editor.getDocument('json');

    // Another conversation's list, then the draft comes back before its uploads.
    await sync(editor, refsOf('blob:b'));
    editor.setDocument('json', restored);
    await moment();
    expect(markdown(editor)).toBe('old');

    await sync(editor, refsOf('blob:a'));
    expect(markdown(editor)).toBe('old [Image #1]');
  });
});
