import type { ChannelListItem, ChannelPublicMember } from '@lobechat/types';
import type { ISlashOption } from '@lobehub/editor';
import {
  INSERT_MENTION_COMMAND,
  ReactCodePlugin,
  ReactLinkHighlightPlugin,
  ReactListPlugin,
  ReactMentionPlugin,
} from '@lobehub/editor';
import { ChatInput, Editor, SendButton, useEditor } from '@lobehub/editor/react';
import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { $getSelection, $isRangeSelection, KEY_DOWN_COMMAND } from 'lexical';
import { Reply, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useLocalDragUpload } from '@/components/DragUploadZone/useLocalDragUpload';
import { usePasteFile } from '@/components/DragUploadZone/usePasteFile';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useEnterToSend } from '@/hooks/useEnterToSend';
import { usePermission } from '@/hooks/usePermission';
import { useSingleton } from '@/hooks/useSingleton';
import { cacheScope } from '@/libs/replica';
import type { ChannelQueuedSendInput } from '@/store/channel';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { ComposerActions } from './ComposerActions';
import { ComposerAttachments } from './ComposerAttachments';
import { MemberAvatar } from './MemberAvatar';
import { isCurrentUserMember, memberName } from './memberName';
import { getMentionGroups, mentionDescription } from './mentionGroups';
import type { ChannelMentionInvite } from './mentions';
import {
  $insertChannelMentionBoundary,
  channelMentionIds,
  channelMentionInvites,
} from './mentions';
import { createChannelSendRequest } from './sendRequest';
import { styles } from './styles';
import { useAttachments } from './useAttachments';
import { useComposerDraft } from './useComposerDraft';
import { useMentionInvites } from './useMentionInvites';
import type { ChannelReplyTarget } from './useReplyTarget';

export type ChannelComposerMessage = Omit<ChannelQueuedSendInput, 'channelId' | 'threadId'>;

export type ChannelComposerSend = (
  content: string,
  mentions: string[],
  requestKey: string,
  fileIds?: string[],
  replyToId?: string,
) => Promise<void>;

/** Exactly one way to hand a message over. */
type ComposerDelivery =
  | {
      /**
       * Hands the message over without waiting and clears the input at once; the timeline
       * shows whether it sent.
       */
      onQueue: (message: ChannelComposerMessage) => void;
      onSend?: never;
    }
  | {
      onQueue?: never;
      /** Waits for the server, keeping the input until the message is stored. */
      onSend: ChannelComposerSend;
    };

const plugins = [ReactCodePlugin, ReactListPlugin, ReactLinkHighlightPlugin];

/** Highlighted text like the rest of the line, not the editor's default boxed tag. */
const mentionTheme = { mention: stylex.props(styles.composerMention).className };
const writeMention = (node: { label: string }) => `@${node.label}`;

/** Keeps ChatInput's raised card (elevated background, border, soft shadow) from the chat page. */
const inputShell = { borderRadius: 12 };

export function Composer({
  activity,
  channel,
  draftKey,
  members,
  onQueue,
  onSend,
  placeholder,
  replyTarget,
  onCancelReply,
}: {
  /** Who is replying right now; shown on the line above the input. Omit to drop that line. */
  activity?: ReactNode;
  /** Lets an @mention invite people and Agents from outside the Channel. */
  channel?: ChannelListItem;
  /** Where unsent input is kept; see {@link useComposerDraft}. */
  draftKey: string;
  members: ChannelPublicMember[];
  placeholder: string;
  replyTarget?: ChannelReplyTarget | null;
  onCancelReply?: () => void;
} & ComposerDelivery) {
  const { t } = useTranslation('channel');
  const workspaceId = useActiveWorkspaceId();
  const editor = useEditor();
  const draft = useComposerDraft(editor, draftKey);
  useEffect(() => {
    if (replyTarget) editor.focus();
  }, [editor, replyTarget]);
  const shouldSendOnEnter = useEnterToSend();
  const userId = useUserStore(userProfileSelectors.userId);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const previousDocument = useRef('');
  const [error, setError] = useState('');
  /** The card the mention picker docks to, full width above the input like an IM. */
  const [card, setCard] = useState<HTMLDivElement | null>(null);
  const requests = useSingleton(createChannelSendRequest);
  const attachments = useAttachments(draftKey);
  const { allowed } = usePermission('create_content');
  const enableUpload = useServerConfigStore((s) => featureFlagsSelectors(s).enableKnowledgeBase);
  const canUpload = allowed && enableUpload;
  const upload = (files: File[]) => {
    if (!sending.current && canUpload) return attachments.upload(files);
  };
  // Keep consuming file drops even when uploading is blocked; the callback gates uploads.
  const { getContainerProps } = useLocalDragUpload({ onUploadFiles: upload });
  usePasteFile(editor, upload);
  const hasDraft = !!content.trim() || attachments.items.length > 0;
  const memberIds = members.map((member) => member.id);
  // Mentioning yourself notifies nobody and picks no reply.
  const mentionable = members.filter((member) => !isCurrentUserMember(member, userId));
  const invites = useMentionInvites(channel, members);
  const canMention = mentionable.length > 0 || invites.enabled;
  /** Types an @ at the caret and opens the same mention picker as typing it. */
  const startMention = () => {
    const lexical = editor.getLexicalEditor();
    lexical?.focus(
      () =>
        lexical.update(() => {
          // The picker ignores programmatic text until a keystroke re-arms it; doing both in
          // one update keeps the intermediate state from closing it again.
          lexical.dispatchCommand(
            KEY_DOWN_COMMAND,
            new KeyboardEvent('keydown', { key: 'Process' }),
          );
          if ($insertChannelMentionBoundary(new KeyboardEvent('keydown', { key: '@' }))) return;
          const selection = $getSelection();
          if ($isRangeSelection(selection)) selection.insertText('@');
        }),
      { defaultSelection: 'rootEnd' },
    );
  };
  const send = async () => {
    const value = String(editor.getDocument('markdown') || '').trim();
    const fileIds = attachments.readyFileIds();
    if (sending.current || !fileIds || (!value && !fileIds.length)) return;
    const document = editor.getDocument('json');
    const outsiders = channelMentionInvites(document);
    sending.current = true;
    // A queued message leaves the input at once; only inviting someone new waits first.
    if (!onQueue || outsiders.length) setBusy(true);
    setError('');
    invites.clearError();
    const sentRevision = draft.snapshot();
    const clearInput = () => {
      editor.cleanDocument();
      draft.clear(sentRevision);
      attachments.clear();
      setContent('');
    };
    try {
      // Mentioned outsiders join first, so the message can address them as members.
      const invited = await invites.resolve(outsiders);
      if (!invited) return;
      const mentions = [...new Set([...channelMentionIds(document, memberIds), ...invited])];
      if (onQueue) {
        onQueue({
          attachments: attachments.items.flatMap((item) =>
            item.fileId && item.fileUrl
              ? [
                  {
                    fileType: item.file.type,
                    id: item.fileId,
                    name: item.file.name,
                    size: item.file.size,
                    url: item.fileUrl,
                  },
                ]
              : [],
          ),
          content: value,
          fileIds,
          mentions,
          replyTo: replyTarget ?? undefined,
          replyToId: replyTarget?.id,
        });
        clearInput();
        return;
      }
      const requestKey = requests.get(`${cacheScope.get()}:${draftKey}`, {
        content: value,
        fileIds,
        mentions,
        replyToId: replyTarget?.id,
      });
      await onSend?.(value, mentions, requestKey, fileIds, replyTarget?.id);
      requests.complete(requestKey);
      clearInput();
    } catch (cause) {
      console.error('Failed to send Channel message', cause);
      setError(t('sendFailed'));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  const preview = attachments.items.length > 0 && (
    <ComposerAttachments
      disabled={busy}
      items={attachments.items}
      onRemove={attachments.remove}
      onRetry={attachments.retry}
    />
  );
  return (
    <WideScreenContainer fullWidth paddingInline={8}>
      <Flexbox {...stylex.props(styles.composer)} gap={4} {...getContainerProps()}>
        {/* Without an activity line the input meets the feed directly, with no empty strip. */}
        {activity != null && (
          <div {...stylex.props(styles.composerStatus)}>
            <Flexbox horizontal align="center" style={{ minWidth: 0 }}>
              {activity}
            </Flexbox>
          </div>
        )}
        <ChatInput
          maxHeight={480}
          minHeight={0}
          resize={false}
          slashMenuRef={setCard}
          style={inputShell}
          styles={{ body: { overflow: 'visible', padding: 0 } }}
          header={
            replyTarget || preview ? (
              <Flexbox gap={4}>
                {replyTarget && (
                  <Flexbox horizontal align="center" gap={8} padding={8}>
                    <Reply color={cssVar.colorTextTertiary} size={14} />
                    <Flexbox flex={1} style={{ minWidth: 0 }}>
                      <Text ellipsis fontSize={12} type="secondary">
                        {t('reply.to', { name: replyTarget.author.name || t('deletedMember') })}
                        {' · '}
                        {replyTarget.content || t('reply.attachment')}
                      </Text>
                    </Flexbox>
                    <ActionIcon
                      aria-label={t('reply.cancel')}
                      disabled={busy}
                      icon={X}
                      size="small"
                      onClick={onCancelReply}
                    />
                  </Flexbox>
                )}
                {preview}
              </Flexbox>
            ) : undefined
          }
        >
          <div {...stylex.props(styles.composerRow)}>
            <ComposerActions
              disabled={busy}
              upload={
                enableUpload
                  ? { blocked: !allowed, onFiles: (files) => void upload(files) }
                  : undefined
              }
              onMention={canMention ? startMention : undefined}
            />
            <div {...stylex.props(styles.composerEditor)}>
              <Editor
                autoFocus
                aria-label={placeholder}
                content=""
                editable={!busy}
                editor={editor}
                getPopupContainer={() => card}
                placeholder={placeholder}
                plugins={plugins}
                slashPlacement="top"
                type="text"
                variant="chat"
                mentionOption={{
                  items: async (search) => {
                    const query = search?.matchingString || '';
                    const outsiders = await invites.options(query);
                    const options = getMentionGroups(
                      mentionable,
                      query,
                      t('deletedMember'),
                      !!workspaceId,
                    ).flatMap<ISlashOption>((group) => {
                      // Read when the picker opens; subscribing would rerender on every list change.
                      const agents = homeAgentListSelectors.allAgents(useHomeStore.getState());
                      const items = group.members.map((member) => {
                        const label = memberName(member, t('deletedMember'));
                        const agent = member.agentId
                          ? agents.find((item) => item.id === member.agentId)
                          : undefined;
                        return {
                          description: mentionDescription(
                            label,
                            agent?.title,
                            agent?.description || member.description,
                          ),
                          icon: <MemberAvatar member={member} size={24} />,
                          key: member.id,
                          label,
                          metadata: { type: 'channel-member', id: member.id },
                        };
                      });
                      return group.actorType
                        ? [
                            {
                              type: 'section' as const,
                              key: group.actorType,
                              label: t(group.actorType === 'user' ? 'membersTitle' : 'agents'),
                              items,
                            },
                          ]
                        : items;
                    });
                    return outsiders.length
                      ? [
                          ...options,
                          {
                            type: 'section' as const,
                            key: 'invite',
                            label: t('mentionInvite.section'),
                            items: outsiders,
                          },
                        ]
                      : options;
                  },
                  markdownWriter: writeMention,
                  onSelect: (instance, option) => {
                    instance.dispatchCommand(INSERT_MENTION_COMMAND, {
                      label: String(option.label),
                      metadata: option.metadata,
                    });
                    // Choosing someone outside the Channel brings them in right away.
                    if (option.metadata?.type === 'channel-invite')
                      invites.invite(option.metadata as ChannelMentionInvite);
                    // Leave the decorator's cursor node before the next @ is typed.
                    instance.getLexicalEditor()?.update(() => {
                      const selection = $getSelection();
                      if ($isRangeSelection(selection)) selection.insertText(' ');
                    });
                  },
                }}
                onBlur={() => draft.flush()}
                onInit={() => requestAnimationFrame(draft.restore)}
                onChange={() => {
                  // onTextChange skips the first dirty update in the editor. A first
                  // paste/keystroke must enable Send, while caret moves keep retries idempotent.
                  const json = editor.getDocument('json');
                  const document = JSON.stringify(json);
                  if (document !== previousDocument.current) {
                    previousDocument.current = document;
                    setContent(String(editor.getDocument('markdown') || ''));
                    draft.save();
                  }
                }}
                onKeyDown={({ event }) =>
                  (mentionable.length > 0 || invites.enabled) &&
                  $insertChannelMentionBoundary(event)
                }
                onPressEnter={({ event }) => {
                  if (event.isComposing || !shouldSendOnEnter(event)) return;
                  void send();
                  return true;
                }}
              >
                {/* <Editor> registers its own mention plugin after `plugins`, and a later
                    registration replaces the config; a child registers last, so this theme wins. */}
                <ReactMentionPlugin markdownWriter={writeMention} theme={mentionTheme} />
              </Editor>
            </div>
            {/* Replies run asynchronously, so Send never turns into Stop; each reply stops from the activity line. */}
            {/* Enter sends; like an IM, the button only appears once there is something to send. */}
            {(hasDraft || busy) && (
              <SendButton
                aria-label={t('send')}
                disabled={busy || attachments.blocked}
                loading={busy}
                shape="round"
                size={28}
                type="primary"
                onSend={() => void send()}
              />
            )}
          </div>
        </ChatInput>
        {(error || invites.error) && (
          <span {...stylex.props(styles.error)} role="alert">
            {error || invites.error}
          </span>
        )}
        {invites.agentDrafts}
      </Flexbox>
    </WideScreenContainer>
  );
}
