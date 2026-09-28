import { type MessageActionItem, type MessageActionItemOrDivider } from '../../../types';
import { DIVIDER_KEY, type MessageActionSlot } from './types';

const DIVIDER: MessageActionItemOrDivider = { type: 'divider' };

const isDivider = (item: MessageActionItemOrDivider) => 'type' in item && item.type === 'divider';

/**
 * Resolves slot keys against the built actions. Dividers are declarative
 * group boundaries, not literal items: when the actions around one opt out
 * (return null), leading/trailing/consecutive dividers are dropped so a
 * conditionally hidden group never leaves a dangling separator.
 *
 * A submenu slot follows the same rule one level down — it disappears entirely
 * when none of its children survive, so an empty "Advanced" entry can never be
 * opened onto nothing.
 */
export const resolveSlots = (
  slots: MessageActionSlot[],
  built: Record<string, MessageActionItem | null>,
): MessageActionItemOrDivider[] => {
  const out: MessageActionItemOrDivider[] = [];
  for (const slot of slots) {
    if (slot === DIVIDER_KEY) {
      if (out.length > 0 && !isDivider(out.at(-1)!)) out.push(DIVIDER);
      continue;
    }

    if (typeof slot === 'object') {
      const parent = built[slot.key];
      if (!parent) continue;
      const children = slot.children
        .map((key) => built[key])
        .filter((child): child is MessageActionItem => Boolean(child));
      if (children.length === 0) continue;
      out.push({ ...parent, children });
      continue;
    }

    const item = built[slot];
    if (item) out.push(item);
  }
  while (out.length > 0 && isDivider(out.at(-1)!)) out.pop();
  return out;
};
