import {
  $getRoot,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  type CommandListener,
  type CommandListenerPriority,
  type ElementNode,
  KEY_ARROW_UP_COMMAND,
  KEY_BACKSPACE_COMMAND,
  type LexicalCommand,
  type LexicalEditor,
  mergeRegister,
  type RangeSelection,
} from 'lexical';

/**
 * The page title and its body read as one document (AFFiNE's doc title works
 * the same way): the caret walks between them with the arrow keys, Enter and
 * Backspace. The title is a plain textarea outside the Lexical editor, so the
 * body finds it through this attribute.
 */
export const PAGE_TITLE_INPUT_ATTRIBUTE = 'data-page-title-input';

export const findPageTitleInput = (host: ParentNode | null | undefined) =>
  host?.querySelector<HTMLTextAreaElement>(`textarea[${PAGE_TITLE_INPUT_ATTRIBUTE}]`) ?? null;

const isTitleInputWritable = (input: HTMLTextAreaElement | null): input is HTMLTextAreaElement =>
  !!input && !input.readOnly && !input.disabled;

/** Put the caret at the end of the title, the way AFFiNE's `focusTitle` does. */
export const focusTitleInputEnd = (input: HTMLTextAreaElement) => {
  input.focus();
  const end = input.value.length;
  input.setSelectionRange(end, end);
};

const LINE_BREAKS = /[^\S\n\r\u2028\u2029]*[\n\r\u2028\u2029]+[^\S\n\r\u2028\u2029]*/g;

/**
 * The title is a single line (it is the document's filename too), so line
 * breaks that reach it — a multi-line paste, a dropped selection — become a
 * single space instead of splitting the title.
 */
export const flattenTitleLineBreaks = (value: string) => value.replaceAll(LINE_BREAKS, ' ');

const isSingleLineTextArea = (input: HTMLTextAreaElement) => {
  const lineHeight = Number.parseFloat(getComputedStyle(input).lineHeight);
  // Without a measurable line box (jsdom, `line-height: normal`) treat the
  // title as one line, which is what it is almost always.
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return true;
  return input.scrollHeight < lineHeight * 1.5;
};

/**
 * ArrowDown leaves the title for the body once there is no title line below
 * the caret: always on a one-line title, and on a wrapped title once the caret
 * is at its end (the browser moves it there from the last line first).
 */
export const shouldTitleArrowDownEnterBody = (input: HTMLTextAreaElement) => {
  const { selectionEnd, selectionStart, value } = input;
  if (selectionStart !== selectionEnd) return false;
  if (selectionEnd === value.length) return true;
  return isSingleLineTextArea(input);
};

const hasModifier = (event: KeyboardEvent) =>
  event.shiftKey || event.altKey || event.metaKey || event.ctrlKey;

/** The collapsed caret, when it sits in the body's first top-level block. */
const $getCaretInFirstBlock = (): { block: ElementNode; selection: RangeSelection } | null => {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;

  const block = selection.anchor.getNode().getTopLevelElement();
  const first = $getRoot().getFirstChild();
  if (!block || !first || !block.is(first)) return null;

  return { block, selection };
};

/** True when nothing in `block` comes before the caret. */
const $isCaretAtBlockStart = (block: ElementNode, selection: RangeSelection) => {
  if (selection.anchor.offset !== 0) return false;

  let node = selection.anchor.getNode();
  while (!node.is(block)) {
    if (node.getPreviousSibling()) return false;
    const parent = node.getParent();
    if (!parent) return false;
    node = parent;
  }
  return true;
};

const getCaretRect = (range: Range): DOMRect | null => {
  const rects = range.getClientRects?.();
  if (rects) {
    for (const rect of rects) if (rect.height > 0) return rect;
  }
  const rect = range.getBoundingClientRect?.();
  return rect && rect.height > 0 ? rect : null;
};

/**
 * Whether the DOM caret is on the first visual line of `blockElement`: its
 * top is less than one line below the block's top.
 */
export const isDomCaretOnFirstLine = (blockElement: HTMLElement | null): boolean => {
  if (!blockElement) return false;
  const domSelection = window.getSelection();
  if (!domSelection || domSelection.rangeCount === 0) return false;

  const range = domSelection.getRangeAt(0);
  if (!blockElement.contains(range.startContainer)) return false;

  const caretRect = getCaretRect(range);
  if (!caretRect) return false;

  return caretRect.top - blockElement.getBoundingClientRect().top < caretRect.height;
};

type CommandRegistrar = <P>(
  command: LexicalCommand<P>,
  listener: CommandListener<P>,
  priority: CommandListenerPriority,
) => () => void;

interface TitleBodyNavigationOptions {
  /** The title input, or null when there is none or it cannot be written. */
  getTitleInput: () => HTMLTextAreaElement | null;
  /** Injected by tests; defaults to measuring the DOM caret. */
  isCaretOnFirstLine?: (blockElement: HTMLElement | null) => boolean;
  /**
   * Where ArrowUp registers. The editor kernel's own ArrowUp handlers (the
   * virtual-block plugin opens a temporary line above the first block) run in
   * its high-command lane, ahead of any plain Lexical listener, so the page
   * passes `editor.registerHighCommand` to get in before them. Defaults to the
   * Lexical editor itself (tests).
   */
  registerHighCommand?: CommandRegistrar;
}

/**
 * Body side of the title ⇄ body walk:
 * - ArrowUp on the first line of the first block moves to the end of the title.
 * - Backspace at the very start of a plain first paragraph moves to the end of
 *   the title. Its text is never merged into the title, which doubles as the
 *   filename.
 * Either way, an empty first line is dropped on the way out unless it is the
 * body's only line — nothing is left behind that the user did not write.
 *
 * Exported for tests, which drive a bare Lexical editor without the kernel.
 */
export const registerTitleBodyNavigationOnLexical = (
  lexicalEditor: LexicalEditor,
  {
    getTitleInput,
    isCaretOnFirstLine = isDomCaretOnFirstLine,
    registerHighCommand = (command, listener, priority) =>
      lexicalEditor.registerCommand(command, listener, priority),
  }: TitleBodyNavigationOptions,
) => {
  const takeTitleInput = () => {
    const input = getTitleInput();
    return isTitleInputWritable(input) ? input : null;
  };

  // The caret leaves the editor, so drop its selection: committing a body
  // selection after the title took focus would pull the DOM caret back.
  const $moveCaretToTitle = (
    event: KeyboardEvent | null,
    input: HTMLTextAreaElement,
    block: ElementNode,
  ) => {
    // The last line stays so the body keeps somewhere to click back into.
    if ($isParagraphNode(block) && block.getChildrenSize() === 0 && block.getNextSibling()) {
      block.remove();
    }
    event?.preventDefault();
    $setSelection(null);
    focusTitleInputEnd(input);
    return true;
  };

  return mergeRegister(
    registerHighCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => {
        if (!lexicalEditor.isEditable()) return false;
        if (event && (hasModifier(event) || event.isComposing)) return false;

        const caret = $getCaretInFirstBlock();
        if (!caret) return false;

        const onFirstLine =
          $isCaretAtBlockStart(caret.block, caret.selection) ||
          isCaretOnFirstLine(lexicalEditor.getElementByKey(caret.block.getKey()));
        if (!onFirstLine) return false;

        const input = takeTitleInput();
        if (!input) return false;

        return $moveCaretToTitle(event, input, caret.block);
      },
      COMMAND_PRIORITY_HIGH,
    ),
    lexicalEditor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event) => {
        if (!lexicalEditor.isEditable()) return false;
        if (event?.isComposing) return false;

        const caret = $getCaretInFirstBlock();
        // Headings, quotes and lists turn into a plain paragraph first (their
        // own Backspace handling); an indented paragraph outdents first.
        if (!caret || !$isParagraphNode(caret.block) || caret.block.getIndent() > 0) return false;
        if (!$isCaretAtBlockStart(caret.block, caret.selection)) return false;

        const input = takeTitleInput();
        if (!input) return false;

        return $moveCaretToTitle(event, input, caret.block);
      },
      COMMAND_PRIORITY_LOW,
    ),
  );
};
