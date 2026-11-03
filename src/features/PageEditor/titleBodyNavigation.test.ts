/**
 * @vitest-environment happy-dom
 */
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  createEditor,
  KEY_ARROW_UP_COMMAND,
  KEY_BACKSPACE_COMMAND,
  type LexicalEditor,
  type ParagraphNode,
} from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  findPageTitleInput,
  flattenTitleLineBreaks,
  PAGE_TITLE_INPUT_ATTRIBUTE,
  registerTitleBodyNavigationOnLexical,
  shouldTitleArrowDownEnterBody,
} from './titleBodyNavigation';

const commit = (editor: LexicalEditor, fn: () => void) =>
  new Promise<void>((resolve) => {
    editor.update(fn, { onUpdate: resolve });
  });

const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

const cleanups: (() => void)[] = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  document.body.innerHTML = '';
});

interface SetupOptions {
  isCaretOnFirstLine?: (blockElement: HTMLElement | null) => boolean;
  lines: string[];
  titleReadOnly?: boolean;
}

const setup = async ({ lines, titleReadOnly = false, isCaretOnFirstLine }: SetupOptions) => {
  const host = document.createElement('div');
  const title = document.createElement('textarea');
  title.setAttribute(PAGE_TITLE_INPUT_ATTRIBUTE, 'true');
  title.value = 'My page';
  title.readOnly = titleReadOnly;
  const root = document.createElement('div');
  root.contentEditable = 'true';
  host.append(title, root);
  document.body.append(host);

  const editor = createEditor({
    onError: (error) => {
      throw error;
    },
  });
  editor.setRootElement(root);
  cleanups.push(() => editor.setRootElement(null));

  await commit(editor, () => {
    $getRoot().append(
      ...lines.map((line) => {
        const paragraph = $createParagraphNode();
        if (line) paragraph.append($createTextNode(line));
        return paragraph;
      }),
    );
  });

  cleanups.push(
    registerTitleBodyNavigationOnLexical(editor, {
      getTitleInput: () => findPageTitleInput(host),
      isCaretOnFirstLine: isCaretOnFirstLine ?? (() => false),
    }),
  );

  return { editor, title };
};

const placeCaret = (editor: LexicalEditor, line: number, offset: number) =>
  commit(editor, () => {
    const paragraph = $getRoot().getChildAtIndex<ParagraphNode>(line)!;
    const text = paragraph.getFirstChild();
    if (text) text.select(offset, offset);
    else paragraph.select(0, 0);
  });

const press = (
  editor: LexicalEditor,
  command: 'up' | 'backspace',
  init: KeyboardEventInit = {},
) => {
  const event = new KeyboardEvent('keydown', {
    cancelable: true,
    key: command === 'up' ? 'ArrowUp' : 'Backspace',
    ...init,
  });
  const handled = editor.dispatchCommand(
    command === 'up' ? KEY_ARROW_UP_COMMAND : KEY_BACKSPACE_COMMAND,
    event,
  );
  return { event, handled };
};

const readLines = (editor: LexicalEditor) =>
  editor.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .map((child) => child.getTextContent()),
  );

const expectCaretAtTitleEnd = (title: HTMLTextAreaElement) => {
  expect(document.activeElement).toBe(title);
  expect(title.selectionStart).toBe(title.value.length);
  expect(title.selectionEnd).toBe(title.value.length);
};

describe('registerTitleBodyNavigationOnLexical — ArrowUp', () => {
  it('moves from the start of the first block to the end of the title', async () => {
    const { editor, title } = await setup({ lines: ['first', 'second'] });
    await placeCaret(editor, 0, 0);

    const { event, handled } = press(editor, 'up');
    await settle();

    expect(handled).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expectCaretAtTitleEnd(title);
    // The body lets go of its caret so committing it cannot pull focus back.
    expect(editor.getEditorState().read(() => $getSelection())).toBeNull();
  });

  it('moves to the title from anywhere on the first visual line', async () => {
    const isCaretOnFirstLine = vi.fn(() => true);
    const { editor, title } = await setup({ isCaretOnFirstLine, lines: ['first line', 'second'] });
    await placeCaret(editor, 0, 4);

    expect(press(editor, 'up').handled).toBe(true);
    expect(isCaretOnFirstLine).toHaveBeenCalledWith(expect.any(HTMLElement));
    expectCaretAtTitleEnd(title);
  });

  it('leaves the browser to move up a line when the caret is below the first line', async () => {
    const { editor, title } = await setup({ lines: ['a long wrapped first paragraph'] });
    await placeCaret(editor, 0, 12);

    const { event, handled } = press(editor, 'up');

    expect(handled).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(title);
  });

  it('ignores blocks after the first one', async () => {
    const { editor, title } = await setup({
      isCaretOnFirstLine: () => true,
      lines: ['first', 'second'],
    });
    await placeCaret(editor, 1, 0);

    expect(press(editor, 'up').handled).toBe(false);
    expect(document.activeElement).not.toBe(title);
  });

  it('keeps Shift+ArrowUp for extending the selection', async () => {
    const { editor } = await setup({ lines: ['first'] });
    await placeCaret(editor, 0, 0);

    expect(press(editor, 'up', { shiftKey: true }).handled).toBe(false);
  });

  it('stays in the body when the title cannot be written', async () => {
    const { editor, title } = await setup({ lines: ['first'], titleReadOnly: true });
    await placeCaret(editor, 0, 0);

    expect(press(editor, 'up').handled).toBe(false);
    expect(document.activeElement).not.toBe(title);
  });

  it('does nothing while the body is read-only', async () => {
    const { editor, title } = await setup({ lines: ['first'] });
    await placeCaret(editor, 0, 0);
    editor.setEditable(false);

    expect(press(editor, 'up').handled).toBe(false);
    expect(document.activeElement).not.toBe(title);
  });
});

describe('registerTitleBodyNavigationOnLexical — Backspace', () => {
  it('drops an empty first line and moves to the end of the title', async () => {
    const { editor, title } = await setup({ lines: ['', 'second'] });
    await placeCaret(editor, 0, 0);

    const { event, handled } = press(editor, 'backspace');
    await settle();

    expect(handled).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(readLines(editor)).toEqual(['second']);
    expectCaretAtTitleEnd(title);
  });

  it('keeps the only line of the body so there is still somewhere to type', async () => {
    const { editor, title } = await setup({ lines: [''] });
    await placeCaret(editor, 0, 0);

    expect(press(editor, 'backspace').handled).toBe(true);
    await settle();

    expect(readLines(editor)).toEqual(['']);
    expectCaretAtTitleEnd(title);
  });

  it('moves to the title without merging the first line into it', async () => {
    const { editor, title } = await setup({ lines: ['first', 'second'] });
    await placeCaret(editor, 0, 0);

    expect(press(editor, 'backspace').handled).toBe(true);
    await settle();

    expect(readLines(editor)).toEqual(['first', 'second']);
    expect(title.value).toBe('My page');
    expectCaretAtTitleEnd(title);
  });

  it('deletes text normally when the caret is not at the start', async () => {
    const { editor, title } = await setup({ lines: ['first'] });
    await placeCaret(editor, 0, 3);

    expect(press(editor, 'backspace').handled).toBe(false);
    expect(document.activeElement).not.toBe(title);
  });

  it('leaves the start of a later line to merge with the line above', async () => {
    const { editor, title } = await setup({ lines: ['first', 'second'] });
    await placeCaret(editor, 1, 0);

    expect(press(editor, 'backspace').handled).toBe(false);
    expect(document.activeElement).not.toBe(title);
  });

  it('outdents an indented first paragraph before leaving it', async () => {
    const { editor } = await setup({ lines: ['first'] });
    await commit(editor, () => {
      $getRoot().getFirstChildOrThrow<ParagraphNode>().setIndent(1);
    });
    await placeCaret(editor, 0, 0);

    expect(press(editor, 'backspace').handled).toBe(false);
  });
});

describe('flattenTitleLineBreaks', () => {
  it('turns each run of line breaks, with the spaces around it, into one space', () => {
    expect(flattenTitleLineBreaks('Line one\nLine two')).toBe('Line one Line two');
    expect(flattenTitleLineBreaks('a  \r\n\r\n  b')).toBe('a b');
    expect(flattenTitleLineBreaks('a\u2028b')).toBe('a b');
  });

  it('leaves a single-line title untouched', () => {
    expect(flattenTitleLineBreaks('  spaced  title ')).toBe('  spaced  title ');
  });
});

describe('shouldTitleArrowDownEnterBody', () => {
  const createTitle = (value: string, caret: number, end = caret) => {
    const input = document.createElement('textarea');
    input.value = value;
    document.body.append(input);
    input.setSelectionRange(caret, end);
    return input;
  };

  it('enters the body from the end of the title', () => {
    expect(shouldTitleArrowDownEnterBody(createTitle('Title', 5))).toBe(true);
  });

  it('enters the body from anywhere in a one-line title', () => {
    expect(shouldTitleArrowDownEnterBody(createTitle('Title', 2))).toBe(true);
  });

  it('lets the browser move down a wrapped title until the caret reaches its end', () => {
    const input = createTitle('A title long enough to wrap onto a second line', 3);
    input.style.lineHeight = '40px';
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 80 });

    expect(shouldTitleArrowDownEnterBody(input)).toBe(false);
  });

  it('collapses a selection first instead of leaving the title', () => {
    expect(shouldTitleArrowDownEnterBody(createTitle('Title', 0, 5))).toBe(false);
  });
});
