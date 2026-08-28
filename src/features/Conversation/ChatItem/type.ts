import type { DivProps, FlexboxProps } from '@lobehub/ui';
import { type AlertProps, type AvatarProps } from '@lobehub/ui/base-ui';
import type { EditableMessageProps, MetaData } from '@lobehub/ui/chat';
import type { ReactNode } from 'react';

/**
 * `MetaData` from `@lobehub/ui/chat` predates the agent's `name`/`title` split, so
 * it only carries `title`. Every caller in this app passes an agent meta that also
 * has `name` (see `useAgentMeta`), which is what the author label resolves from.
 */
export type ChatItemAvatarMeta = MetaData & { name?: string | null };

export interface ChatItemProps extends Omit<FlexboxProps, 'children' | 'onChange'> {
  aboveMessage?: ReactNode;
  actionAddon?: ReactNode;
  actions?: ReactNode;
  actionsWrapWidth?: number;
  afterActions?: ReactNode;
  avatar: ChatItemAvatarMeta;
  avatarProps?: AvatarProps;
  belowMessage?: ReactNode;
  children?: ReactNode;
  customAvatarRender?: (avatar: ChatItemAvatarMeta, node: ReactNode) => ReactNode;
  customErrorRender?: (error: AlertProps) => ReactNode;
  /**
   * @description Whether the chat item is disabled
   * @default false
   */
  disabled?: boolean;
  /**
   * @description Whether the chat item is in editing mode
   */
  editing?: boolean;
  /**
   * @description Props for Error render
   */
  error?: AlertProps;
  fontSize?: number;
  /**
   * @description Whether the chat item is in loading state
   */
  loading?: boolean;
  /**
   * @description The message content of the chat item
   */
  message?: ReactNode;
  messageExtra?: ReactNode;
  /**
   * Avatar click handler
   */
  onAvatarClick?: () => void;
  onDoubleClick?: DivProps['onDoubleClick'];
  /**
   * @default "..."
   */
  placeholderMessage?: string;
  /**
   * @description The placement of the chat item
   * @default 'left'
   */
  placement?: 'left' | 'right';
  /**
   * @description Whether to hide the avatar
   * @default false
   */
  showAvatar?: boolean;
  /**
   * @description Whether to show the title of the chat item
   */
  showTitle?: boolean;
  text?: EditableMessageProps['text'];
  /**
   * @description The timestamp of the chat item
   */
  time?: number;
  titleAddon?: ReactNode;
}
