import type { ChannelDetail } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import { createStore, Provider } from '@/features/Conversation/store';
import WideScreenContainer from '@/features/WideScreenContainer';

import { ArchivedNotice } from './ArchivedNotice';
import { ThreadRootMessage } from './ChannelMessage';
import { Composer } from './Composer';
import { styles } from './styles';
import type { ChannelThreadDraft } from './threadDraft';
import { channelDraftKey } from './useComposerDraft';

/** No thread query, subscription or database write until the user sends. */
export function DraftThreadConversation({
  detail,
  draft,
  onSend,
}: {
  detail: ChannelDetail;
  draft: ChannelThreadDraft;
  onSend: ComponentProps<typeof Composer>['onSend'];
}) {
  const { t } = useTranslation('channel');
  return (
    <Provider
      createStore={() =>
        createStore({
          context: { agentId: `channel:${detail.channel.id}` },
          messages: [],
          skipFetch: true,
        })
      }
    >
      <Flexbox {...stylex.props(styles.body)}>
        <Flexbox aria-label={t('thread')} {...stylex.props(styles.feed)}>
          <WideScreenContainer fullWidth paddingInline={24}>
            <ThreadRootMessage
              detail={{ ...detail, attachments: draft.attachments }}
              root={draft.root}
            />
            <p {...stylex.props(styles.muted)}>{t('threadEmpty')}</p>
          </WideScreenContainer>
        </Flexbox>
        {/* The channel can be archived while this preview is open. */}
        {detail.channel.status === 'archived' ? (
          <ArchivedNotice channel={detail.channel} threadId={null} />
        ) : (
          <Composer
            draftKey={channelDraftKey(detail.channel.id, `draft:${draft.root.id}`)}
            members={detail.members.filter((member) => member.status === 'active')}
            placeholder={t('threadComposer')}
            onSend={onSend}
          />
        )}
      </Flexbox>
    </Provider>
  );
}
