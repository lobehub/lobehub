import { ChatMessageError, ErrorResponse, ErrorType } from '@lobechat/types';
import { t } from 'i18next';

export const getMessageError = async (response: Response): Promise<ChatMessageError> => {
  let chatMessageError: ChatMessageError;

  // try to get the biz error
  try {
    const data = (await response.json()) as ErrorResponse;
    chatMessageError = {
      body: data.body,
      message: t(`response.${data.errorType}`, { ns: 'error' }),
      type: data.errorType,
    };
  } catch {
    // if not return, then it's a common error
    chatMessageError = {
      message: t(`response.${response.status}`, { ns: 'error' }),
      type: response.status as ErrorType,
    };
  }

  return chatMessageError;
};
