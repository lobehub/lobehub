import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  type ListType,
} from '@lexical/list';
import { $createHeadingNode, $isHeadingNode, type HeadingNode } from '@lexical/rich-text';
import { mergeRegister } from '@lexical/utils';
import {
  $getListItemHeading,
  $setListItemHeading,
  registerRichListDocument,
  type RichListMarkdownService,
} from '@lobechat/editor-runtime';
import {
  type getKernelFromEditor,
  IMarkdownShortCutService,
  INSERT_HEADING_COMMAND,
  useLexicalComposerContext,
} from '@lobehub/editor';
import {
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isRootNode,
  $isTextNode,
  COMMAND_PRIORITY_NORMAL,
  type ElementNode,
  KEY_BACKSPACE_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type TextNode,
} from 'lexical';
import { type FC, useLayoutEffect } from 'react';

type IEditorKernel = NonNullable<ReturnType<typeof getKernelFromEditor>>;

// The marker the caret has just completed: `- `, `* `, `+ `, `1. `, `[ ] `,
// `- [x] ` — the same shortcuts @lobehub/editor's ListPlugin registers.
const LIST_SHORTCUT_MARKER = /^\s*(?:[*+-]|\d+\.|(?:-\s)?\s?\[[\sx]?])\s$/i;

/** Marks list items rendered as headings, for the editor's stylesheet. */
export const LIST_HEADING_ATTRIBUTE = 'data-list-heading';

type RunTransformers = (
  parentNode: ElementNode,
  anchorNode: TextNode,
  anchorOffset: number,
  trigger?: 'enter',
) => boolean;

interface MarkdownServiceInternals extends RichListMarkdownService {
  // Not part of the exported interface: the entry point typing runs through.
  runTransformers: RunTransformers;
}

/**
 * Typing a list marker at the start of a heading makes a list item that keeps
 * the heading level. @lobehub/editor replaces the heading with a plain list.
 */
const patchListShortcut = (service: MarkdownServiceInternals) => {
  const runTransformers = service.runTransformers;
  const patched: RunTransformers = function (this: unknown, ...args) {
    const [parentNode, anchorNode, anchorOffset] = args;
    const tag =
      $isHeadingNode(parentNode) &&
      LIST_SHORTCUT_MARKER.test(anchorNode.getTextContent().slice(0, anchorOffset))
        ? parentNode.getTag()
        : undefined;

    const handled = runTransformers.apply(this, args);
    if (handled && tag) {
      const item = $getSelection()?.getNodes()[0];
      const listItem = $isListItemNode(item) ? item : item?.getParent();
      if ($isListItemNode(listItem)) $setListItemHeading(listItem, tag);
    }
    return handled;
  };
  service.runTransformers = patched;

  return () => {
    if (service.runTransformers === patched) service.runTransformers = runTransformers;
  };
};

const LIST_COMMANDS: [typeof INSERT_UNORDERED_LIST_COMMAND, ListType][] = [
  [INSERT_UNORDERED_LIST_COMMAND, 'bullet'],
  [INSERT_ORDERED_LIST_COMMAND, 'number'],
  [INSERT_CHECK_LIST_COMMAND, 'check'],
];

/** Turns the selected headings into list items of their level. */
const $headingsToList = (listType: ListType): boolean => {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;

  const blocks = new Map<string, LexicalNode>();
  for (const node of selection.getNodes()) {
    const block = node.getTopLevelElement() ?? node;
    blocks.set(block.getKey(), block);
  }
  const headings = [...blocks.values()];
  if (headings.length === 0 || !headings.every($isHeadingNode)) return false;

  const anchor = selection.anchor;
  const caretKey = anchor.type === 'element' ? anchor.key : undefined;
  const caretOffset = anchor.offset;

  for (const heading of headings as HeadingNode[]) {
    const item = $createListItemNode(listType === 'check' ? false : undefined);
    item.append(...heading.getChildren());
    item.setFormat(heading.getFormatType());
    $setListItemHeading(item, heading.getTag());
    const list = $createListNode(listType);
    list.append(item);
    heading.replace(list);
    if (caretKey === heading.getKey()) item.select(caretOffset, caretOffset);
  }
  return true;
};

/** `/h3` inside list items styles them as headings rather than replacing them. */
const $headingOnListItems = (tag: Parameters<typeof $createHeadingNode>[0]): boolean => {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;

  const items = new Map<string, ListItemNode>();
  for (const node of selection.getNodes()) {
    const item = $isListItemNode(node) ? node : node.getParents().find($isListItemNode);
    if (!item) return false;
    items.set(item.getKey(), item);
  }
  if (items.size === 0) return false;

  const all = [...items.values()];
  const next = all.every((item) => $getListItemHeading(item) === tag) ? undefined : tag;
  for (const item of all) $setListItemHeading(item, next);
  return true;
};

/** Backspace at the start of a heading list item gives back the heading. */
const $listItemToHeading = (): boolean => {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.offset !== 0)
    return false;

  const anchorNode = selection.anchor.getNode();
  let item: LexicalNode | null = anchorNode;
  if ($isTextNode(anchorNode)) {
    if (anchorNode.getPreviousSibling()) return false;
    item = anchorNode.getParent();
  }
  if (!$isListItemNode(item) || !$isRootNode(item.getParent()?.getParent())) return false;

  const tag = $getListItemHeading(item);
  if (!tag) return false;

  const heading = $createHeadingNode(tag);
  item.replace(heading, true);
  heading.select(0, 0);
  return true;
};

const registerHeadingAttribute = (editor: LexicalEditor) =>
  editor.registerMutationListener(ListItemNode, (mutations) => {
    editor.getEditorState().read(() => {
      for (const [key, mutation] of mutations) {
        if (mutation === 'destroyed') continue;
        const element = editor.getElementByKey(key);
        const node = $getNodeByKey(key);
        if (!element || !$isListItemNode(node)) continue;
        const tag = $getListItemHeading(node);
        if (tag) element.setAttribute(LIST_HEADING_ATTRIBUTE, tag);
        else element.removeAttribute(LIST_HEADING_ATTRIBUTE);
      }
    });
  });

/**
 * The page editor's side of rich lists: typing, commands and rendering. What
 * the document itself needs (Markdown, numbering) is shared with the server's
 * headless editor through `registerRichListDocument`.
 */
export class RichListPlugin {
  static pluginName = 'LobeRichListPlugin';

  private cleanup?: () => void;
  private kernel: IEditorKernel;

  constructor(kernel: IEditorKernel) {
    this.kernel = kernel;
  }

  onInit(editor: LexicalEditor): void {
    const internals = this.kernel.requireService(
      IMarkdownShortCutService,
    ) as unknown as MarkdownServiceInternals | null;

    this.cleanup = mergeRegister(
      internals ? patchListShortcut(internals) : () => {},
      registerRichListDocument(editor, internals),
      registerHeadingAttribute(editor),
      ...LIST_COMMANDS.map(([command, listType]) =>
        editor.registerCommand(command, () => $headingsToList(listType), COMMAND_PRIORITY_NORMAL),
      ),
      editor.registerCommand(
        INSERT_HEADING_COMMAND,
        (payload) => $headingOnListItems(payload.tag),
        COMMAND_PRIORITY_NORMAL,
      ),
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        (event) => {
          if (!$listItemToHeading()) return false;
          event?.preventDefault();
          return true;
        },
        COMMAND_PRIORITY_NORMAL,
      ),
    );
  }

  destroy(): void {
    this.cleanup?.();
  }
}

export const ReactRichListPlugin: FC = () => {
  const [editor] = useLexicalComposerContext();

  useLayoutEffect(() => {
    editor.registerPlugin(RichListPlugin as never);
  }, [editor]);

  return null;
};

ReactRichListPlugin.displayName = 'ReactRichListPlugin';
