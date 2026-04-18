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
 * Slot in a bar/menu list. A string is an action key; `'divider'` inserts a
 * divider.
 */
export type MessageActionSlot = string;

export const DIVIDER_KEY = 'divider';
