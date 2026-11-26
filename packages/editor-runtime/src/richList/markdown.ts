import { $isListItemNode, ListItemNode } from '@lexical/list';
import type { LexicalNode } from 'lexical';

import { $getListItemHeading } from './headingState';

type MarkdownWriter = (
  ctx: {
    addProcessor: (processor: (before: string, content: string, after: string) => string) => void;
  },
  node: LexicalNode,
) => void | boolean;

/**
 * The part of @lobehub/editor's markdown service the rich list needs.
 * `markdownWriters` is the writer table it serialises with; it is not part of
 * the service's exported interface.
 */
export interface RichListMarkdownService {
  markdownWriters: Record<string, MarkdownWriter>;
  registerMarkdownReader: (type: string, reader: never, level?: number) => void;
}

// @lobehub/editor's MARKDOWN_READER_LEVEL_HIGH. The package's main entry pulls
// in React, so modules the server loads cannot import the constant from it.
const MARKDOWN_READER_LEVEL_HIGH = 1;

interface ReadNode {
  [key: string]: unknown;
  children?: ReadNode[];
  type: string;
}

/** `- ### Title`: the item's heading level follows its list marker. */
const patchListItemWriter = (service: RichListMarkdownService) => {
  const type = ListItemNode.getType();
  const write = service.markdownWriters[type];
  if (!write) return () => {};

  const patched: MarkdownWriter = (ctx, node) => {
    const tag = $isListItemNode(node) ? $getListItemHeading(node) : undefined;
    if (tag) {
      const hashes = `${'#'.repeat(Number(tag.slice(1)))} `;
      ctx.addProcessor((before, content, after) => `${before}${hashes}${content}${after}`);
    }
    return write(ctx, node);
  };
  service.markdownWriters[type] = patched;

  return () => {
    if (service.markdownWriters[type] === patched) service.markdownWriters[type] = write;
  };
};

const readListItem = (
  children: ReadNode[],
  index: number,
  { checked, heading }: { checked?: unknown; heading?: unknown } = {},
): ReadNode => ({
  checked: typeof checked === 'boolean' ? checked : undefined,
  children,
  direction: 'ltr',
  format: '',
  indent: 0,
  type: 'listitem',
  value: index + 1,
  version: 1,
  ...(heading ? { $: { listHeading: heading } } : {}),
});

/**
 * Reads `- ### Title` back into a heading list item. Items without a heading
 * fall through to ListPlugin's reader.
 */
const listItemReader = (node: { checked?: unknown }, children: ReadNode[], index: number) => {
  if (!children.some((child) => child.type === 'heading')) return false;

  return children.map((child) => {
    if (child.type === 'heading')
      return readListItem(child.children ?? [], index, {
        checked: node.checked,
        heading: child.tag,
      });
    if (child.type === 'paragraph')
      return readListItem(child.children ?? [], index, { checked: node.checked });
    if (child.type === 'list') return readListItem([child], index);
    return child;
  });
};

/**
 * Makes the markdown service read and write heading list items. Register it
 * after ListPlugin, whose list item writer it wraps.
 */
export const registerRichListMarkdown = (service: RichListMarkdownService) => {
  service.registerMarkdownReader('listItem', listItemReader as never, MARKDOWN_READER_LEVEL_HIGH);
  return patchListItemWriter(service);
};
