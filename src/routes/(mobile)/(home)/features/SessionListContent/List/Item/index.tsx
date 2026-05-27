import type { SidebarAgentItem } from '@lobechat/types';
import type { DragEvent } from 'react';
import { memo, useMemo, useState } from 'react';
import { shallow } from 'zustand/shallow';

import { DEFAULT_AVATAR } from '@/const/meta';
import { isDesktop } from '@/const/version';
import AgentGroupAvatar from '@/features/AgentGroupAvatar';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import ListItem from '../../ListItem';
import CreateGroupModal from '../../Modals/CreateGroupModal';
import Actions from './Actions';

interface AgentItemProps {
  groupId?: string;
  item: SidebarAgentItem;
}

const AgentItem = memo<AgentItemProps>(({ groupId, item }) => {
  const { id, avatar, backgroundColor, pinned, title, type, updatedAt } = item;
  const [open, setOpen] = useState(false);
  const [createGroupModalOpen, setCreateGroupModalOpen] = useState(false);

  const openAgentInNewWindow = useGlobalStore((s) => s.openAgentInNewWindow);

  const [loading] = useChatStore((s) => [
    operationSelectors.isAgentRuntimeRunning(s) && id === s.activeAgentId,
  ]);
  const activeAgentId = useChatStore((s) => s.activeAgentId);
  const active = activeAgentId === id;

  const handleDoubleClick = () => {
    if (isDesktop) {
      openAgentInNewWindow(id);
    }
  };

  const handleDragStart = (e: DragEvent) => {
    // Set drag data to identify the session being dragged
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDragEnd = (e: DragEvent) => {
    // If drag ends without being dropped in a valid target, open in new window
    if (isDesktop && e.dataTransfer.dropEffect === 'none') {
      openAgentInNewWindow(id);
    }
  };

  const actions = useMemo(
    () => (
      <Actions
        group={groupId}
        id={id}
        openCreateGroupModal={() => setCreateGroupModalOpen(true)}
        parentType={type}
        pinned={pinned}
        setOpen={setOpen}
      />
    ),
    [groupId, id, pinned, type],
  );

  const currentUser = useUserStore((s) => ({
    avatar: userProfileSelectors.userAvatar(s),
  }));

  const displayAvatar = useMemo<string | { avatar: string; background?: string }[]>(() => {
    if (type !== 'group') return typeof avatar === 'string' ? avatar : DEFAULT_AVATAR;

    if (Array.isArray(avatar) && avatar.length > 0) {
      return [
        {
          avatar: currentUser.avatar || DEFAULT_AVATAR,
          background: undefined,
        },
        ...avatar.map((member) => ({
          avatar: member.avatar || DEFAULT_AVATAR,
          background: member.background,
        })),
      ];
    }

    return [
      {
        avatar: currentUser.avatar || DEFAULT_AVATAR,
        background: undefined,
      },
    ];
  }, [avatar, currentUser.avatar, type]);

  const customAvatar =
    type === 'group' && typeof avatar === 'string' ? (
      <AgentGroupAvatar
        avatar={avatar}
        backgroundColor={backgroundColor || undefined}
        memberAvatars={[]}
        size={40}
      />
    ) : undefined;

  return (
    <>
      <ListItem
        actions={actions}
        active={active}
        avatar={displayAvatar}
        avatarBackground={backgroundColor || undefined}
        customAvatar={customAvatar}
        date={updatedAt?.valueOf()}
        draggable={isDesktop}
        key={id}
        loading={loading}
        pin={pinned}
        showAction={open}
        title={title || 'Untitled Agent'}
        type={type}
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
      <CreateGroupModal
        id={id}
        open={createGroupModalOpen}
        onCancel={() => setCreateGroupModalOpen(false)}
      />
    </>
  );
}, shallow);

export default AgentItem;
