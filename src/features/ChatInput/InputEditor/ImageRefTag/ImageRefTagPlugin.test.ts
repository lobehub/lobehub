import { $dfs } from '@lexical/utils';
import type { IEditor } from '@lobehub/editor';
import { CommonPlugin, Kernel, MarkdownPlugin, moment } from '@lobehub/editor';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type ElementNode,
  HISTORIC_TAG,
} from 'lexical';
import { describe, expect, it, vi } from 'vitest';

import type { ImageUploadRef } from '../../utils/imageUploads';
import {
  $createImageRefTagNode,
  $isImageRefTagNode,
  type ImageRefTagNode,
} from './ImageRefTagNode';
import {
  ImageRefTagPlugin,
  PRUNE_UNATTACHED_IMAGE_REFS_COMMAND,
  SYNC_IMAGE_REF_TAGS_COMMAND,
} from './ImageRefTagPlugin';

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
  { removed }: { removed?: string[] } = {},
) => {
  editor.dispatchCommand(SYNC_IMAGE_REF_TAGS_COMMAND, { refs, removed });
  await moment();
};

/**
 * Adds references at the end of the text, as editor data saved before references stopped
 * being inserted brings them back, then syncs them with the attachment list.
 */
const addReferences = async (editor: IEditor, refs: Map<string, ImageUploadRef>) => {
  editor.getLexicalEditor()!.update(() => {
    const paragraph = $getRoot().getLastChild() as ElementNode;
    for (const ref of refs.values()) {
      paragraph.append($createImageRefTagNode(ref.src, ref.number), $createTextNode(' '));
    }
  });
  await sync(editor, refs);
};

// The exported markdown escapes `[`, which still reads as the literal text `[Image #N]`.
const markdown = (editor: IEditor) =>
  String(editor.getDocument('markdown')).trim().replaceAll('\\[', '[');

/** Replaces the editor state the way undo does. */
const undoTo = async (editor: IEditor, json: unknown) => {
  const lexical = editor.getLexicalEditor()!;
  lexical.setEditorState(lexical.parseEditorState(json as any), { tag: HISTORIC_TAG });
  await moment();
};

/** The references as stored in the editor data a sent message keeps. */
const referencesOf = (editor: IEditor) => {
  const found: { fileId?: string; number: number; src: string }[] = [];
  const walk = (node: any) => {
    if (node?.type === 'image-ref-tag') {
      const { fileId, number, src } = node;
      found.push({ ...(fileId && { fileId }), number, src });
    }
    node?.children?.forEach(walk);
  };
  walk((editor.getDocument('json') as any)?.root);
  return found;
};

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
    await addReferences(editor, refsOf('blob:a'));

    const lexical = editor.getLexicalEditor()!;
    const rendered = lexical.getEditorState().read(() =>
      $dfs()
        .map(({ node }) => node)
        .filter($isImageRefTagNode)
        .map((node) => node.decorate(lexical)),
    );

    expect(rendered).toEqual(['chip 1']);
  });

  it('writes references as [Image #N]', async () => {
    const editor = createEditor();
    await setText(editor, 'compare ');

    await addReferences(editor, refsOf('blob:a', 'blob:b'));

    expect(markdown(editor)).toBe('compare [Image #1] [Image #2]');
  });

  it('adds no reference when an image is attached', async () => {
    const editor = createEditor();
    await setText(editor, 'hi');

    await sync(editor, refsOf('blob:a'));

    expect(referencesOf(editor)).toEqual([]);
  });

  it('renumbers references when an earlier image is removed', async () => {
    const editor = createEditor();
    await setText(editor, 'see ');
    await addReferences(editor, refsOf('blob:a', 'blob:b'));

    await sync(editor, refsOf('blob:b'), { removed: ['blob:a'] });

    expect(markdown(editor)).toBe('see [Image #1]');
  });

  it('removes references to images that are no longer attached', async () => {
    const editor = createEditor();
    await setText(editor, 'look ');
    await addReferences(editor, refsOf('blob:a'));

    await sync(editor, refsOf(), { removed: ['blob:a'] });

    expect(markdown(editor)).toBe('look');
  });

  it('leaves references to unlisted images out of the text, even after undo', async () => {
    const editor = createEditor();
    await setText(editor, 'a ');
    await addReferences(editor, refsOf('blob:a', 'blob:b'));
    const beforeRemoval = editor.getDocument('json');

    // Removing image #1 and then undoing brings its reference and the old numbers back.
    await sync(editor, refsOf('blob:b'), { removed: ['blob:a'] });
    editor.setDocument('json', beforeRemoval);
    await moment();

    // The removed image's reference writes nothing; only its trailing space remains.
    expect(markdown(editor).replaceAll(/\s+/g, ' ')).toBe('a [Image #1]');
  });

  it('stores the current numbers in the editor data after undo brings old ones back', async () => {
    const editor = createEditor();
    await setText(editor, 'a ');
    await addReferences(editor, refsOf('blob:a', 'blob:b'));
    const beforeRemoval = editor.getDocument('json');

    await sync(editor, refsOf('blob:b'), { removed: ['blob:a'] });
    await undoTo(editor, beforeRemoval);

    // The sent message renders its chips from these numbers, so they must match the text.
    expect(referencesOf(editor)).toEqual([{ number: 1, src: 'blob:b' }]);
  });

  it('binds a reference restored from a sent message to its image by file id', async () => {
    const editor = createEditor();
    await setText(editor, 'what is ');
    await addReferences(editor, refsOf('blob:a', 'blob:b'));
    // Both uploads finish, so the references record the uploaded files' ids.
    await sync(
      editor,
      new Map([
        ['blob:a', { fileId: 'file-a', number: 1, src: 'blob:a' }],
        ['blob:b', { fileId: 'file-b', number: 2, src: 'blob:b' }],
      ]),
    );
    const sentEditorData = editor.getDocument('json');

    // Restoring the message brings back its editor data, and its images under server URLs.
    await sync(editor, refsOf(), { removed: ['blob:a', 'blob:b'] });
    editor.setDocument('json', sentEditorData);
    await moment();
    await sync(
      editor,
      new Map([
        ['https://cdn/a.png', { fileId: 'file-a', number: 1, src: 'https://cdn/a.png' }],
        ['https://cdn/b.png', { fileId: 'file-b', number: 2, src: 'https://cdn/b.png' }],
      ]),
    );

    expect(markdown(editor).replaceAll(/\s+/g, ' ')).toBe('what is [Image #1] [Image #2]');
    expect(referencesOf(editor)).toEqual([
      { fileId: 'file-a', number: 1, src: 'https://cdn/a.png' },
      { fileId: 'file-b', number: 2, src: 'https://cdn/b.png' },
    ]);
  });

  it('keeps a restored reference whose image is not listed yet', async () => {
    const editor = createEditor();
    await setText(editor, 'old ');
    await addReferences(editor, refsOf('blob:a'));
    const restored = editor.getDocument('json');

    // Another conversation's list, then the draft comes back before its uploads.
    await sync(editor, refsOf('blob:b'));
    editor.setDocument('json', restored);
    await moment();
    expect(markdown(editor)).toBe('old');

    await sync(editor, refsOf('blob:a'));
    expect(markdown(editor)).toBe('old [Image #1]');
  });

  it('drops references to unattached images before sending', async () => {
    const editor = createEditor();
    await setText(editor, 'see ');
    await addReferences(editor, refsOf('blob:a', 'blob:b'));
    const restored = editor.getDocument('json');

    // After a reload only image b came back; the draft still references both.
    await sync(editor, refsOf('blob:b'));
    editor.setDocument('json', restored);
    await moment();

    editor.dispatchCommand(PRUNE_UNATTACHED_IMAGE_REFS_COMMAND, undefined);

    // Read synchronously, the way sending reads the editor data right after.
    expect(referencesOf(editor)).toEqual([{ number: 1, src: 'blob:b' }]);
  });
});
