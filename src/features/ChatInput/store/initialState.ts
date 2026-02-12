import { type IEditor, type SlashOptions } from '@lobehub/editor';
import { type ChatInputProps } from '@lobehub/editor/react';
import { type MenuProps } from '@lobehub/ui';

import { type ActionKeys } from '@/features/ChatInput';

export type SendButtonHandler = (params: {
  clearContent: () => void;
  editor: IEditor;
  getMarkdownContent: () => string;
}) => Promise<void> | void;

export interface SendButtonProps {
  disabled?: boolean;
  generating: boolean;
  onStop: (params: { editor: IEditor }) => void;
  shape?: 'round' | 'default';
}

export const initialSendButtonState: SendButtonProps = {
  disabled: false,
  generating: false,
  onStop: () => {},
};

export interface PublicState {
  agentId?: string;
  allowExpand?: boolean;
  expand?: boolean;
  leftActions: ActionKeys[];
  mentionItems?: SlashOptions['items'];
  mobile?: boolean;
  onMarkdownContentChange?: (content: string) => void;
  onSend?: SendButtonHandler;
  rightActions: ActionKeys[];
  sendButtonProps?: SendButtonProps;
  sendMenu?: MenuProps;
  showTypoBar?: boolean;
}

export interface State extends PublicState {
  editor?: IEditor;
  isContentEmpty: boolean;
  markdownContent: string;
  slashMenuRef: ChatInputProps['slashMenuRef'];
}

export const initialState: State = {
  allowExpand: true,
  expand: false,
  isContentEmpty: false,
  leftActions: [],
  markdownContent: '',
  rightActions: [],
  slashMenuRef: { current: null },
};
