import { type AlertProps, type AvatarProps, type DivProps, type FlexboxProps } from '@lobehub/ui';
import { type EditableMessageProps, type MetaData } from '@lobehub/ui/chat';
import { type ReactNode } from 'react';

export interface ChatItemProps extends Omit<FlexboxProps, 'children' | 'onChange'> {
  aboveMessage?: ReactNode;
  actions?: ReactNode;
  actionsWrapWidth?: number;
  avatar: MetaData;
  avatarProps?: AvatarProps;
  belowMessage?: ReactNode;
  children?: ReactNode;
  customAvatarRender?: (avatar: MetaData, node: ReactNode) => ReactNode;
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
   * Dynamic min-height for new screen effect, e.g. "calc(100dvh - 350px)"
   */
  newScreenMinHeight?: string;
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
