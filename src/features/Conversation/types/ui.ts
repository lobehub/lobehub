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
 * Factory function type for creating message-specific actions
 * Receives message id and returns an action item or null
 */
export type MessageActionFactory = (id: string) => MessageActionItem | null;

/**
 * Action configuration for a specific message type
 */
export interface MessageActionsConfig {
  /**
   * Actions to display in the action bar (always visible)
   */
  bar?: MessageActionItemOrDivider[];
  /**
   * Extra actions to add to the bar, created per-message using factory functions.
   * These are appended after the default/configured bar actions.
   */
  extraBarActions?: MessageActionFactory[];
  /**
   * Extra actions to add to the menu, created per-message using factory functions.
   * These are appended after the default/configured menu actions.
   */
  extraMenuActions?: MessageActionFactory[];
  /**
   * Actions to display in the dropdown menu
   */
  menu?: MessageActionItemOrDivider[];
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
   * @description 是否显示聊天项的名称
   * @default false
   */
  showTitle?: boolean;
}
