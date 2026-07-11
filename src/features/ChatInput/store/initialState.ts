import { type OpenAIChatMessage } from '@lobechat/types';
import { type IEditor, type SlashOptions } from '@lobehub/editor';
import { type ChatInputProps } from '@lobehub/editor/react';
import { type MenuProps } from '@lobehub/ui';

import { type ActionKeys } from '@/features/ChatInput';

export type SendButtonHandler = (params: {
  clearContent: () => void;
  editor: IEditor;
  getEditorData: () => Record<string, any> | undefined;
  getMarkdownContent: () => string;
}) => Promise<void> | void;

export interface SendButtonProps {
  disabled?: boolean;
  generating: boolean;
  onStop: (params: { editor: IEditor }) => void;
  shape?: 'round' | 'default';
  size?: number;
}

export const initialSendButtonState: SendButtonProps = {
  disabled: false,
  generating: false,
  onStop: () => {},
};

export type SlashPlacement = 'top' | 'bottom';

export interface ContextWindowMessage {
  content: string;
  /**
   * Real API-metered totalTokens of the request that produced this message
   * (assistant messages only). Used by TokenTag to calibrate the context-size
   * estimate — the local tokenizer only sees plain-text content, so tool-call
   * args/results are invisible to it and the estimate can be far too low (LOBE-11585).
   */
  totalTokens?: number;
}

export interface ChatInputFeature {
  inputCompletion?: boolean;
  inputHistory?: boolean;
  mention?: boolean;
  slash?: boolean;
}

export interface InputCompletionError {
  body?: unknown;
  errorType?: string;
  httpStatus?: number;
  message: string;
}

export const DEFAULT_CHAT_INPUT_FEATURE = {
  inputCompletion: true,
  inputHistory: true,
  mention: true,
  slash: true,
} as const satisfies Required<ChatInputFeature>;

export interface PublicState {
  agentId?: string;
  allowExpand?: boolean;
  contextWindowMessages?: ContextWindowMessage[];
  draftKey?: string;
  expand?: boolean;
  feature?: ChatInputFeature;
  getMessages?: () => OpenAIChatMessage[];
  leftActions: ActionKeys[];
  mentionItems?: SlashOptions['items'];
  mobile?: boolean;
  onMarkdownContentChange?: (content: string) => void;
  onSend?: SendButtonHandler;
  rightActions: ActionKeys[];
  sendButtonProps?: SendButtonProps;
  sendMenu?: MenuProps;
  showTypoBar?: boolean;
  /**
   * Slash menu placement: 'bottom' for home page (input in center), 'top' for page input (at bottom)
   */
  slashPlacement?: SlashPlacement;
}

export interface State extends PublicState {
  _savedEditorState?: Record<string, any>;
  editor?: IEditor;
  inputCompletionError?: InputCompletionError;
  inputCompletionErrorDismissed: boolean;
  isContentEmpty: boolean;
  markdownContent: string;
  slashMenuRef: ChatInputProps['slashMenuRef'];
}

export const initialState: State = {
  allowExpand: true,
  expand: false,
  feature: DEFAULT_CHAT_INPUT_FEATURE,
  inputCompletionErrorDismissed: false,
  isContentEmpty: false,
  leftActions: [],
  markdownContent: '',
  rightActions: [],
  slashMenuRef: { current: null },
  slashPlacement: 'top',
};
