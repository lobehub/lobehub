import type { VerifyCheckItem } from '@lobechat/types';

/**
 * A derived checklist with no blocking check gates nothing: the Goal review
 * judges required checks only, and repair, evidence collection and the run
 * status all skip optional ones. When none of the items is required, the
 * checklist is the requirement itself, so every item blocks.
 *
 * Only for plans the system derived from the requirement. A plan built from
 * criteria a person configured keeps their choice.
 */
export const requireAllWhenNoneBlocks = <T extends Pick<VerifyCheckItem, 'required'>>(
  items: T[],
): T[] =>
  items.some((item) => item.required) ? items : items.map((item) => ({ ...item, required: true }));
