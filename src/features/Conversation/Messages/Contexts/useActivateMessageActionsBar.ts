import { type MouseEventHandler, useCallback } from 'react';

import {
  type MessageActionType,
  useSetMessageItemActionElementPortialContext,
  useSetMessageItemActionTypeContext,
} from './message-action-context';

type UseActivateMessageActionsBarParams = MessageActionType & {
  disabled?: boolean;
};

export const useActivateMessageActionsBar = ({
  disabled,
  id,
  index,
  type,
}: UseActivateMessageActionsBarParams): MouseEventHandler<HTMLDivElement> => {
  const setMessageItemActionElementPortialContext = useSetMessageItemActionElementPortialContext();
  const setMessageItemActionTypeContext = useSetMessageItemActionTypeContext();

  return useCallback(
    (e) => {
      if (disabled) return;

      setMessageItemActionElementPortialContext(e.currentTarget);
      setMessageItemActionTypeContext({ id, index, type });
    },
    [
      disabled,
      id,
      index,
      setMessageItemActionElementPortialContext,
      setMessageItemActionTypeContext,
      type,
    ],
  );
};
