import React, { memo, useMemo, useState } from 'react';
import { shallow } from 'zustand/shallow';

import { isDesktop } from '@/const/version';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import ListItem from '../../ListItem';
import { openCreateGroupModal } from '../../Modals/CreateGroupModal';
import Actions from './Actions';

interface AgentItemProps {
  groupId?: string;
  id: string;
}

const AgentItem = memo<AgentItemProps>(({ groupId, id }) => {
  const [open, setOpen] = useState(false);

  const openAgentInNewWindow = useGlobalStore((s) => s.openAgentInNewWindow);

  const active = useChatStore((s) => s.activeAgentId === id);
  const loading = useChatStore(
    (s) => operationSelectors.isAgentRuntimeVisiblyRunning(s) && id === s.activeAgentId,
  );

  const item = useHomeStore((s) => homeAgentListSelectors.getAgentById(id)(s));

  const pin = item?.pinned ?? false;
  const title = item?.title ?? 'Untitled';
  const avatar = item?.avatar ?? undefined;
  const avatarBackground = item?.backgroundColor ?? undefined;
  const updateAt = item?.updatedAt;

  const currentUser = useUserStore((s) => ({
    avatar: userProfileSelectors.userAvatar(s),
    name: userProfileSelectors.displayUserName(s) || userProfileSelectors.nickName(s) || 'You',
  }));

  const sessionAvatar = avatar;

  const handleDoubleClick = () => {
    if (isDesktop) {
      openAgentInNewWindow(id);
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    if (isDesktop && e.dataTransfer.dropEffect === 'none') {
      openAgentInNewWindow(id);
    }
  };

  const actions = useMemo(
    () => (
      <Actions
        group={groupId}
        id={id}
        openCreateGroupModal={() => openCreateGroupModal(id)}
        setOpen={setOpen}
      />
    ),
    [groupId, id],
  );

  return (
    <ListItem
      actions={actions}
      active={active}
      avatar={sessionAvatar as any}
      avatarBackground={avatarBackground}
      date={updateAt?.valueOf()}
      draggable={isDesktop}
      key={id}
      loading={loading}
      pin={pin}
      showAction={open}
      title={title}
      type={'agent'}
      styles={{
        container: {
          gap: 12,
        },
        content: {
          gap: 6,
          maskImage: `linear-gradient(90deg, #000 90%, transparent)`,
        },
      }}
      onDoubleClick={handleDoubleClick}
      onDragEnd={handleDragEnd}
      onDragStart={handleDragStart}
    />
  );
}, shallow);

export default AgentItem;
