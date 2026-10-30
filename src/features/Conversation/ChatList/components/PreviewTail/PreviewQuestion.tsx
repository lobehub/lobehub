'use client';

import type { UIChatMessage } from '@lobechat/types';
import { memo } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useUserAvatar } from '@/hooks/useUserAvatar';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { ChatItem } from '../../../ChatItem';
import UserMessageContent from '../../../Messages/User/components/MessageContent';

const PreviewQuestion = memo<{ message: UIChatMessage }>(({ message }) => {
  const activeWorkspaceId = useActiveWorkspaceId();
  const avatar = useUserAvatar();
  const title = useUserStore(userProfileSelectors.displayUserName);
  const showSender = Boolean(activeWorkspaceId);

  return (
    <ChatItem
      actions={<div style={{ height: '28px' }} />}
      avatar={{ avatar, title }}
      message={message.content}
      placement={'right'}
      showAvatar={showSender}
      showTitle={showSender}
      time={message.createdAt}
    >
      <UserMessageContent {...message} />
    </ChatItem>
  );
});

PreviewQuestion.displayName = 'PreviewQuestion';

export default PreviewQuestion;
