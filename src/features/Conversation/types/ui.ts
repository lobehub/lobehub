import { type LLMRoleType, type UIChatMessage } from '@lobechat/types';
import { type ActionIconGroupItemType } from '@lobehub/ui';
import { type ChatItemProps } from '@lobehub/ui/chat';
import { type FC, type ReactNode } from 'react';

export type RenderRole = LLMRoleType | 'default' | 'history' | string;
export type RenderMessage = FC<UIChatMessage & { editableContent: ReactNode }>;
export type RenderBelowMessage = FC<UIChatMessage>;
export type RenderMessageExtra = FC<UIChatMessage>;
export type MarkdownCustomRender = (props: {
  dom: ReactNode;
  id: string;
  text: string;
}) => ReactNode;

export type RenderItem = FC<{ key: string } & UIChatMessage & ListItemProps>;

/**
 * Action item with click handler
 */
export interface MessageActionItem extends ActionIconGroupItemType {
  children?: Array<{ handleClick?: () => void; key: string; label: string }>;
  handleClick?: () => void | Promise<void>;
}

/**
 * Action item or divider
 */
export type MessageActionItemOrDivider = MessageActionItem | { type: 'divider' };

/**
 * Action slot reference. A registered action key (e.g. `'copy'`) or the
 * reserved `'divider'` literal.
 *
 * Uses declarative keys rather than pre-built items so per-message action
 * construction stays lazy and per-session/role config lives at the route
 * layer (see `useActionsBarConfig`).
 */
export type MessageActionSlot = string;

/**
 * Action configuration for a specific message type. Lists of registered
 * action keys resolved at render-time against the action registry.
 */
export interface MessageActionsConfig {
  /** Bar slots (always visible as icons) */
  bar?: MessageActionSlot[];
  /** Menu slots (overflow dropdown); when omitted the role's default menu is used */
  menu?: MessageActionSlot[];
}

/**
 * Actions bar configuration by message type
 */
export interface ActionsBarConfig {
  /**
   * Actions configuration for assistant messages
   */
  assistant?: MessageActionsConfig;
  /**
   * Actions configuration for assistant group messages
   * If not provided, falls back to `assistant` config
   */
  assistantGroup?: MessageActionsConfig;
  /**
   * Actions configuration for user messages
   */
  user?: MessageActionsConfig;
}

export interface ListItemProps {
  groupNav?: ChatItemProps['avatarAddon'];

  renderItems?: {
    [role: RenderRole]: RenderItem;
  };

  /**
   * @description Whether to show the chat item title
   * @default false
   */
  showTitle?: boolean;
}
