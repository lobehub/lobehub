'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatInputResourceAccess } from '../../hooks/useChatInputResourceAccess';
import type { ActionProps } from './Action';
import Action from './Action';

export const ChatInputAction = memo<ActionProps>(({ disabled, title, ...rest }) => {
  const { canUseResource, isGroupContext } = useChatInputResourceAccess();
  const { t } = useTranslation('chat');

  return (
    <Action
      {...rest}
      disabled={disabled || !canUseResource}
      title={
        canUseResource ? title : t(isGroupContext ? 'input.viewOnlyGroup' : 'input.viewOnlyAgent')
      }
    />
  );
});

ChatInputAction.displayName = 'ChatInputAction';
