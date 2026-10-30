'use client';

import type { UIChatMessage } from '@lobechat/types';
import { ActionIcon, Avatar, Button, Flexbox, Text, TextArea, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PanelRightClose } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type ConversationContext,
  ConversationProvider,
  MessageItem,
} from '@/features/Conversation';
import { MessageActionProvider } from '@/features/Conversation/Messages/Contexts/MessageActionProvider';
import { dataSelectors, useConversationStore } from '@/features/Conversation/store';
import { useClientDataSWR } from '@/libs/swr';
import { acceptanceCollaborationKeys } from '@/libs/swr/keys';
import { acceptanceCollaborationService } from '@/services/acceptanceCollaboration';
import { useAgentStore } from '@/store/agent';

import { useAcceptanceScope } from '../AcceptanceScope';
import { useAcceptanceBundle } from '../useAcceptanceBundle';

/** Stable, so a missing transcript does not hand the provider a new array each render. */
const EMPTY_MESSAGES: UIChatMessage[] = [];

/** While the agent is replying, how often the transcript is read again. */
const RUNNING_POLL_INTERVAL = 2000;

const styles = stylex.create({
  composer: {
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
    flexShrink: 0,
    paddingBlock: 12,
    paddingInline: 12,
  },
  empty: {
    color: cssVar.colorTextTertiary,
    fontSize: 13,
    paddingBlock: 24,
    paddingInline: 16,
  },
  header: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    flexShrink: 0,
    paddingBlock: 12,
    paddingInline: 12,
  },
  hint: {
    color: cssVar.colorTextTertiary,
    fontSize: 12,
  },
  panel: {
    backgroundColor: cssVar.colorBgContainer,
    height: '100%',
    minHeight: 0,
    overflow: 'hidden',
  },
  thread: {
    flex: '1',
    minHeight: 0,
    overflowY: 'auto',
    paddingBlock: 8,
  },
});

const Transcript = () => {
  const ids = useConversationStore(dataSelectors.displayMessageIds);
  return (
    <MessageActionProvider withSingletonActionsBar={false}>
      {ids.map((id, index) => (
        <MessageItem disableEditing id={id} index={index} key={id} />
      ))}
    </MessageActionProvider>
  );
};

/**
 * The conversation bound to an acceptance, as an edit-collaborator has it.
 *
 * The owner opens the same conversation in their own chat; a collaborator has
 * no seat there, so the transcript is read through the acceptance (as the
 * owner, through the visitor projection) and rendered by the real message
 * renderer without its edit affordances. A message they send lands in the
 * owner's conversation and the owner's agent replies; the transcript is read
 * again every few seconds only while that reply is running.
 */
const CollaboratorTopicPanel = ({ onCollapse }: { onCollapse: () => void }) => {
  const { t } = useTranslation('verify');
  const { acceptanceId } = useAcceptanceScope();
  const { data: bundle } = useAcceptanceBundle(acceptanceId);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const { data, error, mutate } = useClientDataSWR(
    acceptanceCollaborationKeys.conversation(acceptanceId),
    () => acceptanceCollaborationService.getConversation(acceptanceId),
    {
      refreshInterval: (latest) => (latest?.running ? RUNNING_POLL_INTERVAL : 0),
      revalidateOnFocus: true,
    },
  );
  const messages = data?.messages ?? EMPTY_MESSAGES;
  // A transcript with no real coordinates of its own: it is held, never synced.
  // It is also someone else's conversation, read through a grant, so it renders
  // the way a shared topic does — no retry, no raw error details, and none of
  // the owner-scoped side reads (run verification, notebook, memories).
  const context = useMemo<ConversationContext>(
    () => ({
      agentId: '',
      topicId: `acceptance-collaboration:${acceptanceId}`,
      topicShareId: `acceptance-collaboration:${acceptanceId}`,
    }),
    [acceptanceId],
  );

  // Follow the newest turn, like a chat does: what a collaborator comes back
  // for is the latest exchange, not the delivery's opening brief.
  const threadRef = useRef<HTMLDivElement>(null);
  const messageCount = messages.length;
  useEffect(() => {
    const thread = threadRef.current;
    if (thread && messageCount > 0) thread.scrollTop = thread.scrollHeight;
  }, [messageCount]);

  // A send-back starts a new turn in this conversation from outside the panel
  // (the decision bar), and the transcript is only polled while a reply is
  // known to be running — so a status change is the cue to read it again.
  const acceptanceStatus = bundle?.acceptance.status;
  useEffect(() => {
    if (acceptanceStatus) void mutate();
  }, [acceptanceStatus, mutate]);

  const collaboration = bundle?.collaboration;
  const agentId = data?.agentId;
  const agentAvatar = collaboration?.agent.avatar;
  const agentBackground = collaboration?.agent.backgroundColor;
  const agentTitle = collaboration?.agent.title;
  // The assistant rows name the owner's agent, which the collaborator's own
  // agent store has never loaded — without its face and title every reply
  // reads as an unnamed assistant. Seeded only while this panel is mounted,
  // and only when the store does not already know the agent.
  useEffect(() => {
    if (!agentId || useAgentStore.getState().agentMap[agentId]) return;
    useAgentStore.setState((state) => ({
      agentMap: {
        ...state.agentMap,
        [agentId]: {
          avatar: agentAvatar,
          backgroundColor: agentBackground,
          title: agentTitle,
        } as never,
      },
    }));
    return () => {
      useAgentStore.setState((state) => {
        const { [agentId]: _seeded, ...rest } = state.agentMap;
        return { agentMap: rest };
      });
    };
  }, [agentAvatar, agentBackground, agentId, agentTitle]);

  if (!collaboration) return null;
  const agentName = collaboration.agent.title || t('acceptance.collaboration.agentFallback');
  const running = Boolean(data?.running);

  const send = async () => {
    const content = draft.trim();
    if (!content || running) return;
    setSending(true);
    try {
      await acceptanceCollaborationService.send(acceptanceId, content);
      setDraft('');
      await mutate();
    } catch (cause) {
      console.error('[acceptance:collaboration]', cause);
      toast.error(t('acceptance.collaboration.sendFailed'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Flexbox {...stylex.props(styles.panel)}>
      <Flexbox horizontal align={'center'} gap={8} {...stylex.props(styles.header)}>
        <Avatar
          avatar={collaboration.agent.avatar ?? undefined}
          background={collaboration.agent.backgroundColor ?? undefined}
          size={20}
        />
        <Text ellipsis strong style={{ flex: 1, fontSize: 13, minWidth: 0 }}>
          {collaboration.topicTitle ?? agentName}
        </Text>
        <ActionIcon
          icon={PanelRightClose}
          size={'small'}
          title={t('acceptance.ledger.collapse')}
          onClick={onCollapse}
        />
      </Flexbox>
      <div ref={threadRef} {...stylex.props(styles.thread)}>
        {error && !data ? (
          <div {...stylex.props(styles.empty)}>{t('acceptance.collaboration.loadFailed')}</div>
        ) : data && messages.length === 0 ? (
          <div {...stylex.props(styles.empty)}>{t('acceptance.collaboration.empty')}</div>
        ) : data ? (
          <ConversationProvider context={context} messages={messages}>
            <Transcript />
          </ConversationProvider>
        ) : null}
      </div>
      <Flexbox gap={8} {...stylex.props(styles.composer)}>
        <span {...stylex.props(styles.hint)}>
          {running ? t('acceptance.collaboration.running') : t('acceptance.collaboration.hint')}
        </span>
        <TextArea
          autoSize={{ maxRows: 6, minRows: 2 }}
          disabled={sending}
          maxLength={4000}
          placeholder={t('acceptance.collaboration.placeholder', { agent: agentName })}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void send();
          }}
        />
        <Button
          disabled={!draft.trim() || running}
          loading={sending}
          style={{ alignSelf: 'flex-end' }}
          type={'primary'}
          onClick={() => void send()}
        >
          {t('acceptance.collaboration.send')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

export default CollaboratorTopicPanel;
