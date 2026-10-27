import type { ChannelPublicMember } from '@lobechat/types';
import {
  INSERT_MENTION_COMMAND,
  ReactCodePlugin,
  ReactLinkHighlightPlugin,
  ReactListPlugin,
  ReactMentionPlugin,
} from '@lobehub/editor';
import { ChatInput, Editor, SendButton, useEditor } from '@lobehub/editor/react';
import { ActionIcon, Flexbox, Upload } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { $getSelection, $isRangeSelection } from 'lexical';
import { Paperclip } from 'lucide-react';
import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useLocalDragUpload } from '@/components/DragUploadZone/useLocalDragUpload';
import { usePasteFile } from '@/components/DragUploadZone/usePasteFile';
import DraftFile from '@/features/ChatInput/Mobile/FilePreview/FileItem/File';
import DraftImage from '@/features/ChatInput/Mobile/FilePreview/FileItem/Image';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useEnterToSend } from '@/hooks/useEnterToSend';
import { usePermission } from '@/hooks/usePermission';
import { useSingleton } from '@/hooks/useSingleton';
import { cacheScope } from '@/libs/replica';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { ComposerRecipients } from './ComposerRecipients';
import { MemberAvatar } from './MemberAvatar';
import { isCurrentUserMember, memberAvatar, memberName } from './memberName';
import { $insertChannelMentionBoundary, channelMentionIds } from './mentions';
import { composerRecipients } from './recipients';
import { createChannelSendRequest } from './sendRequest';
import { styles } from './styles';
import { useAttachments } from './useAttachments';
import { useComposerDraft } from './useComposerDraft';

const plugins = [ReactCodePlugin, ReactListPlugin, ReactLinkHighlightPlugin, ReactMentionPlugin];

export function Composer({
  activity,
  defaultRecipientIds,
  draftKey,
  inThread = false,
  members,
  onSend,
  stoppable,
  onStop,
  placeholder,
}: {
  /** Who is replying right now; shown on the line above the input. */
  activity?: ReactNode;
  /** Agents eligible when the message mentions nobody. */
  defaultRecipientIds: string[];
  /** Where unsent input is kept; see {@link useComposerDraft}. */
  draftKey: string;
  inThread?: boolean;
  members: ChannelPublicMember[];
  /** A reply here that the caller may stop is running; an empty input then offers Stop. */
  stoppable?: boolean;
  onStop?: () => void;
  placeholder?: string;
  onSend: (
    content: string,
    mentions: string[],
    requestKey: string,
    fileIds?: string[],
  ) => Promise<void>;
}) {
  const { t } = useTranslation('channel');
  const editor = useEditor();
  const draft = useComposerDraft(editor, draftKey);
  const shouldSendOnEnter = useEnterToSend();
  const userId = useUserStore(userProfileSelectors.userId);
  const [content, setContent] = useState('');
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const previousDocument = useRef('');
  const [error, setError] = useState('');
  const requests = useSingleton(createChannelSendRequest);
  const attachments = useAttachments();
  const { allowed, reason } = usePermission('create_content');
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
  const send = async () => {
    const value = String(editor.getDocument('markdown') || '').trim();
    const fileIds = attachments.readyFileIds();
    if (sending.current || !fileIds || (!value && !fileIds.length)) return;
    sending.current = true;
    setBusy(true);
    setError('');
    const sentRevision = draft.snapshot();
    const mentions = channelMentionIds(editor.getDocument('json'), memberIds);
    const requestKey = requests.get(`${cacheScope.get()}:${draftKey}`, {
      content: value,
      fileIds,
      mentions,
    });
    try {
      await onSend(value, mentions, requestKey, fileIds);
      requests.complete(requestKey);
      editor.cleanDocument();
      draft.clear(sentRevision);
      attachments.clear();
      setContent('');
      setMentionIds([]);
    } catch (cause) {
      console.error('Failed to send Channel message', cause);
      setError(t('sendFailed'));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  const preview = attachments.items.length > 0 && (
    <Flexbox horizontal gap={8} inert={busy} padding={8} wrap="wrap">
      {attachments.items.map((item) =>
        item.file.type.startsWith('image/') && item.status === 'success' ? (
          <DraftImage
            alt={item.file.name}
            key={item.id}
            src={item.fileUrl}
            onRemove={() => attachments.remove(item.id)}
          />
        ) : (
          <DraftFile
            {...item}
            key={item.id}
            onRemove={() => attachments.remove(item.id)}
            onRetry={() => attachments.retry(item.id)}
          />
        ),
      )}
    </Flexbox>
  );
  return (
    <WideScreenContainer fullWidth paddingInline={24}>
      <Flexbox {...stylex.props(styles.composer)} gap={4} {...getContainerProps()}>
        <div {...stylex.props(styles.composerStatus)}>
          <Flexbox horizontal align="center" style={{ minWidth: 0 }}>
            {activity}
          </Flexbox>
          {hasDraft && (
            <ComposerRecipients
              recipients={composerRecipients({
                defaultRecipientIds,
                inThread,
                members: members.map((member) => ({
                  actorType: member.actorType,
                  avatar: memberAvatar(member),
                  id: member.id,
                  name: memberName(member, t('deletedMember')),
                })),
                mentionIds,
              })}
            />
          )}
        </div>
        <ChatInput
          header={preview || undefined}
          maxHeight={480}
          minHeight={0}
          resize={false}
          styles={{ body: { overflow: 'visible', padding: 0 } }}
        >
          <div {...stylex.props(styles.composerRow)}>
            {enableUpload && (
              <Upload
                multiple
                disabled={busy || !canUpload}
                onFiles={(files) => void upload(files)}
              >
                <ActionIcon
                  aria-label={t('attachments.upload')}
                  disabled={busy || !canUpload}
                  icon={Paperclip}
                  title={reason || t('attachments.upload')}
                />
              </Upload>
            )}
            <div {...stylex.props(styles.composerEditor)}>
              <Editor
                autoFocus
                aria-label={placeholder || t('composer')}
                content=""
                editable={!busy}
                editor={editor}
                placeholder={placeholder || t('composer')}
                plugins={plugins}
                slashPlacement="top"
                type="text"
                variant="chat"
                mentionOption={{
                  items: mentionable.map((member) => ({
                    icon: <MemberAvatar member={member} size={24} />,
                    key: member.id,
                    label: memberName(member, t('deletedMember')),
                    metadata: { type: 'channel-member', id: member.id },
                  })),
                  searchKeys: ['label'],
                  markdownWriter: (node) => `@${node.label}`,
                  onSelect: (instance, option) => {
                    instance.dispatchCommand(INSERT_MENTION_COMMAND, {
                      label: String(option.label),
                      metadata: option.metadata,
                    });
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
                    setMentionIds(channelMentionIds(json, memberIds));
                    draft.save();
                  }
                }}
                onKeyDown={({ event }) =>
                  mentionable.length > 0 && $insertChannelMentionBoundary(event)
                }
                onPressEnter={({ event }) => {
                  if (event.isComposing || !shouldSendOnEnter(event)) return;
                  void send();
                  return true;
                }}
              />
            </div>
            <SendButton
              aria-label={t(stoppable && !hasDraft ? 'stopReply' : 'send')}
              disabled={busy || !hasDraft || attachments.blocked}
              generating={stoppable && !hasDraft}
              loading={busy}
              onSend={() => void send()}
              onStop={onStop}
            />
          </div>
        </ChatInput>
        {error && (
          <span {...stylex.props(styles.error)} role="alert">
            {error}
          </span>
        )}
      </Flexbox>
    </WideScreenContainer>
  );
}
