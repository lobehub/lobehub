import type { ListItemNode } from '@lexical/list';
import type { HeadingTagType } from '@lexical/rich-text';
import { $getState, $setState, createState } from 'lexical';

const HEADING_TAGS = new Set<string>(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** The heading level a list item is styled as; unset for a plain item. */
export const listHeadingState = createState('listHeading', {
  parse: (value) =>
    typeof value === 'string' && HEADING_TAGS.has(value) ? (value as HeadingTagType) : undefined,
});

export const $getListItemHeading = (item: ListItemNode) => $getState(item, listHeadingState);

export const $setListItemHeading = (item: ListItemNode, tag: HeadingTagType | undefined) =>
  $setState(item, listHeadingState, tag);
