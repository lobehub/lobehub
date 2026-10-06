import { type AssistantContentBlock, type UIChatMessage } from '@lobechat/types';

import { type MessageActionItem } from '../../../types';

export type MessageRole = 'user' | 'assistant' | 'group';

/**
 * Runtime context an action builder receives. All fields except `role`/`id`
 * may vary — actions decide what they care about.
 */
export interface MessageActionContext {
  contentBlock?: AssistantContentBlock;
  data: UIChatMessage;
  id: string;
  role: MessageRole;
}

/**
 * A registered action. `useBuild` is a hook — called unconditionally for every
 * message, returns `null` when the action doesn't apply to the current role.
 */
export interface MessageActionDefinition {
  key: string;
  useBuild: (ctx: MessageActionContext) => MessageActionItem | null;
}

/**
 * A submenu: one entry in the menu that opens a nested list of actions.
 *
 * The children are ordinary action keys, so a grouped action stays a normal
 * registry entry — grouping is a property of the menu that shows it, not of
 * the action.
 */
export interface MessageActionGroupSlot {
  /** Action keys to nest, in order. */
  children: string[];
  /** Registry key of the action that provides the submenu's label and icon. */
  key: string;
}

/**
 * Slot in a bar/menu list. A string is an action key; `'divider'` inserts a
 * divider; an object nests its children in a submenu.
 */
export type MessageActionSlot = string | MessageActionGroupSlot;

export const DIVIDER_KEY = 'divider';
