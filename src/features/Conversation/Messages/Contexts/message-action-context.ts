import { type Dispatch, type SetStateAction } from 'react';
import { createContext, useContext } from 'react';

export const MessageItemActionElementPortialContext = createContext<HTMLDivElement | null>(null);

export const SetMessageItemActionElementPortialContext = createContext<
  Dispatch<SetStateAction<HTMLDivElement | null>>
>(() => {});

export const useMessageItemActionElementPortialContext = () => {
  return useContext(MessageItemActionElementPortialContext);
};

export const useSetMessageItemActionElementPortialContext = () => {
  return useContext(SetMessageItemActionElementPortialContext);
};

type AssistantMessageActionType = {
  id: string;
  index: number;
  type: 'assistant';
};
type UserMessageActionType = {
  id: string;
  index: number;
  type: 'user';
};
type AssistantGroupMessageActionType = {
  id: string;
  index: number;
  type: 'assistantGroup';
};
export type MessageActionType =
  | AssistantMessageActionType
  | UserMessageActionType
  | AssistantGroupMessageActionType;

export const MessageItemActionTypeContext = createContext<MessageActionType | null>(null);

export const SetMessageItemActionTypeContext = createContext<
  Dispatch<SetStateAction<MessageActionType | null>>
>(() => {});

export const useMessageItemActionTypeContext = () => {
  return useContext(MessageItemActionTypeContext);
};

export const useSetMessageItemActionTypeContext = () => {
  return useContext(SetMessageItemActionTypeContext);
};
