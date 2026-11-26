import type { ChannelDetail, ChannelPublicMessage } from '@lobechat/types';
import { actionToMessage } from '@lobehub/a2ui/action';
import { type A2uiHost, A2uiHostProvider, SurfaceList } from '@lobehub/a2ui/react';
import { memo, useMemo } from 'react';

import { channelActions } from '@/store/channel';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';

interface MessageSurfacesProps {
  detail: ChannelDetail;
  message: ChannelPublicMessage;
  threadId?: string | null;
}

/**
 * The cards an Agent's reply drew. A button sends its action back as a reply to this message,
 * addressed to the Agent that drew it, so the Agent answers it in the same conversation.
 */
export const MessageSurfaces = memo<MessageSurfacesProps>(({ detail, message, threadId }) => {
  const agentMemberId = detail.members.find(
    (member) => member.agentId && member.agentId === message.author.id,
  )?.id;
  const canAct = detail.channel.status !== 'archived' && !!agentMemberId;
  const channelId = detail.channel.id;
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);

  const host = useMemo<A2uiHost>(
    () => ({
      canAct,
      locale,
      sendAction: async (action, surface) => {
        if (!agentMemberId) return false;
        const sent = await channelActions.queueSend({
          attachments: [],
          channelId,
          content: actionToMessage(action, surface),
          fileIds: [],
          mentions: [agentMemberId],
          replyToId: message.id,
          threadId: threadId ?? message.threadId,
        });
        return !!sent;
      },
    }),
    [agentMemberId, canAct, channelId, locale, message.id, message.threadId, threadId],
  );

  if (!message.surfaces?.length) return null;
  return (
    <A2uiHostProvider value={host}>
      <SurfaceList surfaces={message.surfaces} />
    </A2uiHostProvider>
  );
});

MessageSurfaces.displayName = 'ChannelMessageSurfaces';
