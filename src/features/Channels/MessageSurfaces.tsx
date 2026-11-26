import type { ChannelDetail, ChannelPublicMessage } from '@lobechat/types';
import { actionToMessage } from '@lobehub/a2ui';
import { type A2uiHost, A2uiHostProvider, SurfaceView } from '@lobehub/a2ui/react';
import { Flexbox } from '@lobehub/ui';
import { memo, useMemo, useState } from 'react';

import { useA2uiStatusLabels } from '@/features/A2uiCards/useStatusLabels';
import { channelActions } from '@/store/channel';

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
  // Surfaces submitted from this view; the stored state covers the ones sent before a reload.
  const [submitted, setSubmitted] = useState<ReadonlySet<string>>(() => new Set());

  const statusLabels = useA2uiStatusLabels();
  const host = useMemo<A2uiHost>(
    () => ({
      canAct,
      statusLabels,
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
        if (sent) setSubmitted((ids) => new Set(ids).add(surface.surfaceId));
        return !!sent;
      },
    }),
    [agentMemberId, canAct, channelId, message.id, message.threadId, threadId, statusLabels],
  );

  if (!message.surfaces?.length) return null;
  return (
    <A2uiHostProvider value={host}>
      <Flexbox gap={8}>
        {message.surfaces.map((surface) => {
          const done = submitted.has(surface.surfaceId) || surface.state?.status === 'submitted';
          return (
            <SurfaceView
              key={surface.surfaceId}
              record={surface}
              state={done ? { status: 'submitted' } : surface.state}
              onAction={
                canAct && !done ? (action) => void host.sendAction(action, surface) : undefined
              }
            />
          );
        })}
      </Flexbox>
    </A2uiHostProvider>
  );
});

MessageSurfaces.displayName = 'ChannelMessageSurfaces';
