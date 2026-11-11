'use client';

import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import type { AgentMailComposeMode } from '@lobechat/types';
import {
  ActionIcon,
  Alert,
  Button,
  confirmModal,
  Flexbox,
  Icon,
  Skeleton,
  Text,
  toast,
} from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useLatest, useUnmount } from 'ahooks';
import dayjs from 'dayjs';
import { Paperclip, Trash2, Undo2, X } from 'lucide-react';
import { memo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import {
  agentAccountService,
  type AgentAccountView,
  type AgentMailDraftRow,
  type AgentMailRow,
} from '@/services/agentAccount';

import {
  cancelPendingDiscard,
  clearBackup,
  forgetSendRefusal,
  formatAddress,
  holdDiscard,
  invalidAddresses,
  isRememberedBlock,
  isReplyMode,
  releaseDiscard,
  SEND_BLOCK_KEYS,
  type SendBlock,
  sendBlockOf,
  useSendBlockVersion,
} from './compose';
import { composerStyles as styles } from './composerStyles';
import InlineError from './InlineError';
import { mailWriteActions, UNDO_WINDOW_MS } from './mailWrites';
import RecipientInput from './RecipientInput';
import { type SentMail, useComposer } from './useComposer';

interface SendBlockNoticeProps {
  account: AgentAccountView;
  block: SendBlock;
}

/**
 * Says up front that this address cannot send, instead of letting a person
 * write a mail only to see it refused. Always on screen, never a tooltip.
 */
export const SendBlockNotice = memo<SendBlockNoticeProps>(({ account, block }) => {
  const { t } = useTranslation('setting');
  const navigate = useWorkspaceAwareNavigate();
  const receiveOnly = block === 'receive_only';
  const message =
    receiveOnly && !ENABLE_BUSINESS_FEATURES
      ? t('identity.compose.block.receiveOnlySelfHosted')
      : t(SEND_BLOCK_KEYS[block]);

  return (
    <Alert
      showIcon
      data-testid={'mail-send-block'}
      title={message}
      type={'warning'}
      variant={'soft'}
      action={
        <Flexbox horizontal gap={4}>
          {receiveOnly && ENABLE_BUSINESS_FEATURES && (
            <Button size={'small'} type={'text'} onClick={() => navigate('/settings/plans')}>
              {t('identity.compose.block.viewPlans')}
            </Button>
          )}
          {isRememberedBlock(account, block) && (
            <Button size={'small'} type={'text'} onClick={() => forgetSendRefusal(account.id)}>
              {t('identity.compose.block.tryAgain')}
            </Button>
          )}
        </Flexbox>
      }
    />
  );
});

SendBlockNotice.displayName = 'AgentMailSendBlockNotice';

const TITLE_KEYS = {
  compose: 'identity.compose.title.compose',
  forward: 'identity.compose.title.forward',
  reply: 'identity.compose.title.reply',
  replyAll: 'identity.compose.title.replyAll',
} as const satisfies Record<AgentMailComposeMode, string>;

const SAVE_KEYS = {
  failed: 'identity.compose.save.failed',
  saved: 'identity.compose.save.saved',
  saving: 'identity.compose.save.saving',
} as const;

export interface MailComposerProps {
  /** The address it goes out from; a reply's is the one that received the mail. */
  account: AgentAccountView;
  agentId: string;
  /** Resume this draft. */
  draft?: AgentMailDraftRow;
  /** Answering inside a conversation rather than in a pane of its own. */
  inline?: boolean;
  mode: AgentMailComposeMode;
  /** The composer is done (closed, discarded or sent); the caller unmounts it. */
  onClose: () => void;
  onDraftCreated?: (id: string) => void;
  /** Undo of a discard: open the draft again. */
  onReopenDraft?: (id: string) => void;
  onSent?: (sent: SentMail) => void;
  /** "View" on the sent toast. */
  onViewSent?: (sent: SentMail) => void;
  refresh: () => Promise<unknown>;
  /** The mail answered or forwarded. */
  source?: AgentMailRow;
}

/**
 * Writing a mail, a reply, a reply-all or a forward. Plain text with Markdown;
 * the server turns it into the mail's HTML.
 */
const MailComposer = memo<MailComposerProps>(
  ({
    account,
    agentId,
    draft,
    inline,
    mode,
    onClose,
    onDraftCreated,
    onReopenDraft,
    onSent,
    onViewSent,
    refresh,
    source,
  }) => {
    const { t } = useTranslation(['setting', 'common']);
    const replying = isReplyMode(mode);
    const sourceGone = mode !== 'compose' && !source;
    const composer = useComposer({
      accountId: account.id,
      agentId,
      draft,
      mode,
      onDraftCreated,
      ownAddress: account.identifier,
      refresh,
      replyHeader: source
        ? t('identity.compose.quoteHeader', {
            date: dayjs(source.deliveredAt).format('YYYY-MM-DD HH:mm'),
            sender: source.fromName
              ? `${source.fromName} <${source.fromAddress}>`
              : source.fromAddress,
          })
        : '',
      source,
    });
    const { fields, sending } = composer;
    const [copiesOpened, setShowCopies] = useState(false);
    // Recipients in Cc or Bcc, saved or restored from this browser, are always shown.
    const showCopies = copiesOpened || fields.cc.length > 0 || fields.bcc.length > 0;
    const mountedRef = useRef(true);
    useUnmount(() => {
      mountedRef.current = false;
    });
    // A refusal remembered or lifted anywhere re-renders this, so the block shows at once.
    useSendBlockVersion();
    const block = sendBlockOf(account);

    const invalid = invalidAddresses(fields);
    const missingRecipient = !replying && fields.to.length === 0;
    // Forwarding a mail that has no plain text needs no words of one's own: the
    // server adds the original. Leaving attachments out takes another route,
    // which does need a body.
    const bodyOptional =
      mode === 'forward' &&
      !!source &&
      !source.text.trim() &&
      composer.excludedAttachments.length === 0;
    const emptyBody = !bodyOptional && !fields.text.trim();
    const disabledReason = sourceGone
      ? t('identity.compose.error.targetGone')
      : block
        ? undefined
        : missingRecipient
          ? t('identity.compose.disabled.recipient')
          : emptyBody
            ? t('identity.compose.disabled.body')
            : undefined;
    const canSend = !block && !disabledReason && composer.ready && !sending;

    const close = () => {
      void composer.close();
      onClose();
    };

    const discard = async () => {
      // Closed at once; the save and the discard finish in the background, and
      // never steer the page the reader has since moved on in.
      const detaching = composer.detach();
      onClose();
      const { backupKey, id } = await detaching;
      if (!id) {
        clearBackup(backupKey);
        return;
      }
      const writeId = mailWriteActions.begin({
        accountId: account.id,
        draftDelta: -1,
        ids: [id],
        patch: { removed: true },
        unreadDelta: 0,
      });
      // A discarded draft does not go to the trash: it waits out the undo window instead.
      const timer = setTimeout(async () => {
        releaseDiscard(id);
        // The local copy goes only with the draft: a draft that survives a failed
        // delete still needs a forward's removed attachments.
        await agentAccountService
          .deleteMailDrafts([id])
          .then(() => clearBackup(backupKey))
          .catch((error) => {
            console.error('[AgentMail] discard failed', error);
            toast.error({ title: t('identity.mailbox.failed.discard') });
          });
        await refresh().catch(() => undefined);
        mailWriteActions.end(writeId);
      }, UNDO_WINDOW_MS);
      const undo = toast.success({
        actions: [
          {
            label: t('identity.mailbox.undo'),
            onClick: () => {
              cancelPendingDiscard(id);
              onReopenDraft?.(id);
            },
          },
        ],
        duration: UNDO_WINDOW_MS,
        title: t('identity.mailbox.toast.discarded'),
      });
      // Undo, or the same draft opened again (answering that mail once more), keeps it.
      holdDiscard(id, () => {
        clearTimeout(timer);
        mailWriteActions.end(writeId);
        undo.close();
      });
    };

    const send = async () => {
      if (!canSend) return;
      if (invalid.length > 0) {
        toast.error({
          title: t('identity.compose.error.invalidRecipients', { addresses: invalid.join(', ') }),
        });
        return;
      }
      const go = async () => {
        const sent = await composer.send();
        if (!sent) return;
        // Left for another mail while sending: the send and its toast finish,
        // but this editor no longer steers the page.
        if (mountedRef.current) {
          onSent?.(sent);
          onClose();
        }
        toast.success({
          actions: onViewSent
            ? [{ label: t('identity.compose.sent.view'), onClick: () => onViewSent(sent) }]
            : undefined,
          title: t('identity.compose.sent.title'),
        });
      };
      if (!replying && !fields.subject.trim()) {
        confirmModal({
          content: t('identity.compose.noSubject.content'),
          okText: t('identity.compose.noSubject.confirm'),
          onOk: () => void go(),
          title: t('identity.compose.noSubject.title'),
        });
        return;
      }
      await go();
    };

    const sendRef = useLatest(send);

    if (composer.loadError) {
      return (
        <InlineError
          summary={t('identity.compose.loadFailed')}
          detail={
            composer.loadError instanceof Error
              ? composer.loadError.message
              : String(composer.loadError)
          }
          onRetry={onClose}
        />
      );
    }

    const saveLabel = composer.saveState === 'idle' ? undefined : t(SAVE_KEYS[composer.saveState]);
    const attachments = mode === 'forward' ? (source?.attachments ?? []) : [];

    return (
      <div
        {...stylex.props(styles.root, !inline && styles.rootStandalone)}
        aria-busy={sending || undefined}
        aria-label={t(TITLE_KEYS[mode])}
        data-testid={'mail-composer'}
        role={'form'}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          const mod = event.metaKey || event.ctrlKey;
          if (mod && event.key === 'Enter') {
            event.preventDefault();
            // Leaving the field turns an address still being typed into a chip;
            // send once that edit has rendered.
            const active = event.currentTarget.ownerDocument.activeElement;
            if (active instanceof HTMLInputElement) active.blur();
            setTimeout(() => void sendRef.current(), 0);
          } else if (mod && event.key.toLowerCase() === 's') {
            event.preventDefault();
            void composer.saveNow();
          } else if (event.key === 'Escape' && !sending) {
            event.preventDefault();
            // An address still being typed becomes a chip first, so the close saves it.
            const active = event.currentTarget.ownerDocument.activeElement;
            if (active instanceof HTMLInputElement) active.blur();
            close();
          }
        }}
      >
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <Text fontSize={14} weight={600}>
            {t(TITLE_KEYS[mode])}
          </Text>
          <ActionIcon
            aria-label={t('identity.compose.close')}
            disabled={sending}
            icon={X}
            size={'small'}
            title={t('identity.compose.close')}
            onClick={close}
          />
        </Flexbox>

        {block && <SendBlockNotice account={account} block={block} />}

        {!composer.ready ? (
          <Flexbox gap={8}>
            <Skeleton height={32} width={'100%'} />
            <Skeleton height={32} width={'100%'} />
            <Skeleton height={160} width={'100%'} />
          </Flexbox>
        ) : (
          <>
            <div {...stylex.props(styles.field)}>
              <span {...stylex.props(styles.fieldLabel)}>{t('identity.compose.from')}</span>
              <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                <Text fontSize={13}>
                  {formatAddress({
                    address: account.identifier,
                    name: account.displayName ?? undefined,
                  })}
                </Text>
                <Text fontSize={12} type={'secondary'}>
                  {t('identity.compose.fromNote')}
                </Text>
              </Flexbox>
            </div>

            <div {...stylex.props(styles.field)}>
              <span {...stylex.props(styles.fieldLabel)}>{t('identity.compose.to')}</span>
              <RecipientInput
                aria-label={t('identity.compose.to')}
                autoFocus={!replying && !inline}
                locked={replying}
                readOnly={sending}
                value={fields.to}
                onChange={(to) => composer.setFields({ to })}
              />
              {!replying && !showCopies && (
                <Button size={'small'} type={'text'} onClick={() => setShowCopies(true)}>
                  {t('identity.compose.showCopies')}
                </Button>
              )}
            </div>

            {replying && fields.cc.length > 0 && (
              <div {...stylex.props(styles.field)}>
                <span {...stylex.props(styles.fieldLabel)}>{t('identity.compose.cc')}</span>
                <RecipientInput
                  locked
                  aria-label={t('identity.compose.cc')}
                  value={fields.cc}
                  onChange={() => undefined}
                />
              </div>
            )}

            {!replying && showCopies && (
              <>
                <div {...stylex.props(styles.field)}>
                  <span {...stylex.props(styles.fieldLabel)}>{t('identity.compose.cc')}</span>
                  <RecipientInput
                    aria-label={t('identity.compose.cc')}
                    readOnly={sending}
                    value={fields.cc}
                    onChange={(cc) => composer.setFields({ cc })}
                  />
                </div>
                <div {...stylex.props(styles.field)}>
                  <span {...stylex.props(styles.fieldLabel)}>{t('identity.compose.bcc')}</span>
                  <RecipientInput
                    aria-label={t('identity.compose.bcc')}
                    readOnly={sending}
                    value={fields.bcc}
                    onChange={(bcc) => composer.setFields({ bcc })}
                  />
                </div>
              </>
            )}

            <div {...stylex.props(styles.field)}>
              <span {...stylex.props(styles.fieldLabel)}>{t('identity.compose.subject')}</span>
              <input
                {...stylex.props(styles.input)}
                aria-label={t('identity.compose.subject')}
                maxLength={998}
                readOnly={replying || sending}
                title={replying ? t('identity.compose.replySubjectLocked') : undefined}
                type={'text'}
                value={fields.subject}
                onChange={(event) => composer.setFields({ subject: event.target.value })}
              />
            </div>

            <textarea
              {...stylex.props(styles.textarea)}
              aria-label={t('identity.compose.body')}
              autoFocus={replying || inline}
              placeholder={t('identity.compose.bodyPlaceholder')}
              readOnly={sending}
              onChange={(event) => composer.setFields({ text: event.target.value })}
              value={fields.text}
              // A reply opens above the quote, where the answer goes.
              onFocus={(event) => {
                if (
                  mode !== 'compose' &&
                  event.currentTarget.selectionStart === fields.text.length
                ) {
                  event.currentTarget.setSelectionRange(0, 0);
                  event.currentTarget.scrollTop = 0;
                }
              }}
            />

            {attachments.length > 0 && (
              <Flexbox gap={4}>
                <Text fontSize={12} type={'secondary'}>
                  {t('identity.compose.forwardAttachments')}
                </Text>
                <Flexbox horizontal gap={6} wrap={'wrap'}>
                  {attachments.map((attachment) => {
                    const excluded = composer.excludedAttachments.includes(attachment.index);
                    const name =
                      attachment.filename ||
                      t('identity.compose.attachmentFallback', { index: attachment.index + 1 });
                    return (
                      <span
                        {...stylex.props(styles.attachment)}
                        data-excluded={excluded || undefined}
                        data-testid={'compose-attachment'}
                        key={attachment.index}
                      >
                        <Icon icon={Paperclip} size={12} />
                        <span {...stylex.props(excluded && styles.attachmentExcluded)}>{name}</span>
                        <ActionIcon
                          disabled={sending}
                          icon={excluded ? Undo2 : X}
                          size={'small'}
                          aria-label={t(
                            excluded
                              ? 'identity.compose.keepAttachment'
                              : 'identity.compose.removeAttachment',
                            { name },
                          )}
                          title={t(
                            excluded
                              ? 'identity.compose.keepAttachment'
                              : 'identity.compose.removeAttachment',
                            { name },
                          )}
                          onClick={() => composer.toggleAttachment(attachment.index)}
                        />
                      </span>
                    );
                  })}
                </Flexbox>
              </Flexbox>
            )}
          </>
        )}

        {composer.failure && (
          <Alert
            showIcon
            data-testid={'mail-send-failure'}
            type={'error'}
            variant={'soft'}
            action={
              composer.failure.retryable ? (
                <Button size={'small'} type={'text'} onClick={() => void send()}>
                  {t('identity.mailbox.retry')}
                </Button>
              ) : undefined
            }
            title={
              composer.failure.key === 'identity.compose.block.receiveOnly' &&
              !ENABLE_BUSINESS_FEATURES
                ? t('identity.compose.block.receiveOnlySelfHosted')
                : t(composer.failure.key, { reason: composer.failure.reason ?? '' })
            }
          />
        )}

        <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
          <Button
            data-testid={'mail-send'}
            disabled={!canSend}
            loading={sending}
            title={disabledReason}
            type={'primary'}
            onClick={() => void send()}
          >
            {sending ? t('identity.compose.sending') : t('identity.compose.send')}
          </Button>
          {disabledReason && !sending && (
            <Text fontSize={12} type={'secondary'}>
              {disabledReason}
            </Text>
          )}
          <Flexbox flex={1} />
          {saveLabel &&
            (composer.saveState === 'failed' ? (
              <Button
                danger
                data-testid={'mail-save-state'}
                size={'small'}
                type={'text'}
                onClick={() => void composer.saveNow()}
              >
                {saveLabel}
              </Button>
            ) : (
              <Text data-testid={'mail-save-state'} fontSize={12} type={'secondary'}>
                {saveLabel}
              </Text>
            ))}
          <ActionIcon
            aria-label={t('identity.mailbox.action.discard')}
            disabled={sending}
            icon={Trash2}
            size={'small'}
            title={t('identity.mailbox.action.discard')}
            onClick={() => void discard()}
          />
        </Flexbox>
      </div>
    );
  },
);

MailComposer.displayName = 'AgentMailComposer';

export default MailComposer;
