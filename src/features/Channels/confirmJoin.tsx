import type { ChannelDetail, ChannelPublicMember } from '@lobechat/types';
import { Button, createModal, Flexbox, Text, useModalContext } from '@lobehub/ui';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';

import { MemberAvatarCarousel } from './MemberAvatarCarousel';
import { useJoinChannel } from './useJoinChannel';

interface ConfirmJoinOptions {
  channelId: string;
  members: ChannelPublicMember[];
  threadId: string | null;
  title: string;
}

const JoinBody = ({
  channelId,
  members,
  threadId,
  onJoined,
}: Omit<ConfirmJoinOptions, 'title'> & { onJoined: () => void }) => {
  const { t } = useTranslation(['channel', 'common']);
  const { close } = useModalContext();
  const { join, joining } = useJoinChannel(channelId, threadId);
  const active = members.filter((member) => member.status === 'active');

  return (
    <Flexbox gap={24}>
      <Flexbox horizontal align="center" gap={12}>
        <MemberAvatarCarousel members={active} />
        <Text type="secondary">{t('browse.memberCount', { count: active.length })}</Text>
      </Flexbox>
      <Flexbox horizontal gap={8} justify="flex-end">
        <Button disabled={joining} onClick={close}>
          {t('cancel', { ns: 'common' })}
        </Button>
        <Button
          autoFocus
          loading={joining}
          type="primary"
          onClick={async () => {
            if (!(await join())) return;
            onJoined();
            close();
          }}
        >
          {t('joinModal.confirm')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

/**
 * Asks someone reading a Channel they have not joined to join before they write in it. Joins from
 * inside the dialog and resolves true once the conversation is writable, so the caller can finish
 * what was started; resolves false however the dialog closes without joining.
 */
export const confirmJoin = ({ title, ...body }: ConfirmJoinOptions) =>
  new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (joined: boolean) => {
      if (settled) return;
      settled = true;
      resolve(joined);
    };
    createModal({
      content: <JoinBody {...body} onJoined={() => settle(true)} />,
      footer: null,
      title: i18next.t('joinModal.title', { name: title, ns: 'channel' }),
      width: 400,
      onOpenChange: (open) => {
        if (!open) settle(false);
      },
      onOpenChangeComplete: (open) => {
        if (!open) settle(false);
      },
    });
  });

/**
 * Wraps a write in a Channel the reader has not joined: it asks them to join first, then carries on
 * with the same arguments. Members, and actions that are not offered, pass through unchanged.
 */
export const requireJoin =
  (detail: ChannelDetail | undefined, threadId: string | null) =>
  <A extends unknown[]>(action: ((...args: A) => void) | undefined) => {
    if (!action || !detail || detail.joined !== false) return action;
    return (...args: A) => {
      void confirmJoin({
        channelId: detail.channel.id,
        members: detail.members,
        threadId,
        title: detail.channel.title,
      }).then((joined) => {
        if (joined) action(...args);
      });
    };
  };
