'use client';

import type { AgentMailComposeMode, AgentMailFolder } from '@lobechat/types';
import { Button, Center, Flexbox, Skeleton, Text } from '@lobehub/ui';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AgentAccountView, AgentMailDraftRow, AgentMailRow } from '@/services/agentAccount';

import { replySourceOf, SEND_BLOCK_KEYS, sendBlockOf, useSendBlockVersion } from './compose';
import { useMailDraft } from './ComposePane';
import {
  buildConversationRows,
  idsToMarkReadOnOpen,
  initialExpandedIds,
  initialFocusId,
} from './conversation';
import ConversationMessage from './ConversationMessage';
import InlineError from './InlineError';
import MailComposer from './MailComposer';
import MailDetailToolbar from './MailDetailToolbar';
import { type MailDetailHotkeyTarget, MailHotkeyTarget } from './mailHotkeys';
import type { SentMail } from './useComposer';
import { useConversation, type UseConversationOptions } from './useConversation';

export interface InboxMessageDetailProps extends UseConversationOptions {
  /** The addresses still held; the mail's own may have been released since. */
  accounts: AgentAccountView[];
  agentId: string;
  /** A reply or forward draft of this conversation to resume, from the URL. */
  composeId?: string;
  /** Landed here because the last conversation left, so reading waits for the reader. */
  deferRead?: boolean;
  /** Read-only viewer: mail stays readable, nothing can be changed. */
  disabled?: boolean;
  /** The view it was opened from; trashed mail is only reachable through trash. */
  folder?: AgentMailFolder;
  hasNext: boolean;
  hasPrevious: boolean;
  id: string;
  onBack: () => void;
  /** The open draft changed (created, or closed with `undefined`), for the URL. */
  onComposeChange: (draftId?: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onViewSent: (sent: SentMail) => void;
}

interface Composing {
  draft?: AgentMailDraftRow;
  mode: Exclude<AgentMailComposeMode, 'compose'>;
  /**
   * The mail answered or forwarded, fixed when the editor opens: a newer mail
   * arriving in the conversation must not swap it under the person typing.
   */
  sourceId?: string;
}

/**
 * One conversation, read by id rather than taken from a possibly stale list row.
 * Older mail collapses to a summary line; the newest and anything unread open.
 */
const InboxMessageDetail = memo<InboxMessageDetailProps>(
  ({
    accounts,
    agentId,
    composeId,
    deferRead,
    disabled,
    folder,
    hasNext,
    hasPrevious,
    id,
    onBack,
    onComposeChange,
    onNext,
    onPrevious,
    onViewSent,
    ...options
  }) => {
    const { t } = useTranslation('setting');
    const {
      data: mails,
      error,
      isLoading,
      isValidating,
      mutate,
      restore,
      setStarred,
      setUnread,
      trash,
    } = useConversation(id, folder, options);

    const [expanded, setExpanded] = useState<Set<string>>();
    const [unfolded, setUnfolded] = useState(false);
    const [readArmed, setReadArmed] = useState(!deferRead);
    const openedRef = useRef(false);
    const focusRef = useRef<HTMLDivElement>(null);
    const composerRef = useRef<HTMLDivElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    useSendBlockVersion();
    const [composing, setComposing] = useState<Composing>();
    // A draft named by the URL (a reload, or opened from Drafts) resumes in
    // place, but only under the conversation it answers.
    const linkedDraft = useMailDraft(composing ? undefined : composeId);
    const linked = linkedDraft.data;
    // The draft just closed: the URL still names it until the navigation lands,
    // and resuming it from there would reopen the editor the person closed.
    const [dismissedDraftId, setDismissedDraftId] = useState<string>();
    if (
      !composing &&
      linked &&
      linked.id !== dismissedDraftId &&
      !linkedDraft.isValidating &&
      linked.id === composeId &&
      linked.mode !== 'compose' &&
      mails?.some((mail) => mail.id === linked.sourceMailId)
    ) {
      setComposing({ draft: linked, mode: linked.mode });
    }

    useEffect(() => {
      if (composing) composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [composing]);

    // Seed once per opened conversation: a poll must not undo what the reader toggled.
    useEffect(() => {
      if (!mails || mails.length === 0 || expanded) return;
      setExpanded(initialExpandedIds(mails));
    }, [expanded, mails]);

    useEffect(() => {
      if (expanded) focusRef.current?.scrollIntoView({ block: 'nearest' });
      // Only the first placement; later toggles keep the reader where they are.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [Boolean(expanded)]);

    // One open is one read, so marking unread here does not bounce straight back.
    // The only place opening marks mail read, from a list row, a step or a link.
    // A read-only viewer reads nothing.
    useEffect(() => {
      if (!mails || mails.length === 0 || openedRef.current || !readArmed || disabled) return;
      openedRef.current = true;
      const unread = new Set(idsToMarkReadOnOpen(mails));
      if (unread.size > 0) {
        void setUnread(
          mails.filter((mail) => unread.has(mail.id)),
          false,
        );
      }
    }, [disabled, mails, readArmed, setUnread]);

    if (error && !mails) {
      return (
        <Flexbox padding={4}>
          <InlineError
            detail={error instanceof Error ? error.message : String(error)}
            summary={t('identity.inbox.detail.loadFailed')}
            onRetry={() => void mutate()}
          />
        </Flexbox>
      );
    }

    // An empty answer cached from before (the mail was trashed, then restored)
    // is only believed once the fresh read agrees: "gone" must not flash.
    if (isLoading || !mails || (mails.length === 0 && isValidating)) {
      return (
        <Flexbox gap={12} padding={4}>
          <Skeleton height={32} width={'40%'} />
          <Skeleton height={20} width={'60%'} />
          <Skeleton height={120} width={'100%'} />
        </Flexbox>
      );
    }

    if (mails.length === 0) {
      return (
        <Center gap={12} paddingBlock={48}>
          <Text type={'secondary'}>{t('identity.inbox.detail.gone')}</Text>
          <Button onClick={onBack}>{t('identity.inbox.detail.backToList')}</Button>
        </Center>
      );
    }

    const newest = mails.at(-1)!;
    const released = !accounts.some((item) => item.id === newest.accountId);
    const readOnly = Boolean(disabled) || released;
    const inTrash = folder === 'trash';
    const focusId = initialFocusId(mails);
    const open = expanded ?? new Set<string>();
    const anyUnread = mails.some((mail) => mail.isUnread);
    const starred = mails.filter((mail) => mail.starredAt);
    const rows = buildConversationRows(mails, open, unfolded);
    const byId = new Map(mails.map((mail) => [mail.id, mail]));

    const replySource = replySourceOf(mails);
    const pickedId = composing?.sourceId ?? composing?.draft?.sourceMailId;
    const composeSource = pickedId ? mails.find((mail) => mail.id === pickedId) : undefined;
    // Answering sends from the address that holds the mail.
    const accountOf = (mail?: AgentMailRow) =>
      mail ? accounts.find((item) => item.id === mail.accountId) : undefined;
    const replyBlock = sendBlockOf(accountOf(replySource ?? newest));
    const forwardBlock = sendBlockOf(accountOf(newest));
    const replyDisabled = replySource
      ? replyBlock && t(SEND_BLOCK_KEYS[replyBlock])
      : t('identity.compose.disabled.noInbound');
    const forwardDisabled = forwardBlock && t(SEND_BLOCK_KEYS[forwardBlock]);
    /** Replies answer the newest received mail; a forward carries the one picked, or the newest. */
    const startComposing = (mode: Composing['mode'], picked?: string) => {
      const sourceId = picked ?? (mode === 'forward' ? newest.id : replySource?.id);
      if (!sourceId) return;
      if (composing?.mode === mode && pickedId === sourceId) {
        composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
      setComposing({ mode, sourceId });
    };
    const stopComposing = () => {
      const mode = composing?.mode;
      setDismissedDraftId(composing?.draft?.id ?? composeId);
      setComposing(undefined);
      onComposeChange(undefined);
      // The editor took focus with it; it goes back to the control that opened it.
      setTimeout(() => {
        const active = document.activeElement;
        if (active && active !== document.body) return;
        const testId =
          mode === 'forward'
            ? 'mail-action-forward'
            : mode === 'replyAll'
              ? 'mail-action-reply-all'
              : 'mail-action-reply';
        rootRef.current?.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.focus();
      }, 0);
    };
    const composeAccount = accountOf(composeSource);

    // Unstar clears every star; star marks the newest, as a mail product does —
    // the newest in this view, so the row the reader came from shows it too.
    const inView = (mail: AgentMailRow) =>
      folder === 'inbox'
        ? mail.direction === 'inbound'
        : folder === 'sent'
          ? mail.direction === 'outbound'
          : true;
    const toggleStar = () =>
      void (starred.length > 0
        ? setStarred(starred, false)
        : setStarred([mails.findLast(inView) ?? newest], true));

    // Trash offers only the read toggle (as its toolbar does); everything else
    // waits for the mail to be restored.
    const hotkeys: MailDetailHotkeyTarget | undefined = readOnly
      ? undefined
      : {
          act: (command) => {
            if (command === 'purge') return false;
            if (inTrash && command !== 'read' && command !== 'unread') return false;
            if (command === 'star') toggleStar();
            else if (command === 'trash') void trash(mails);
            // Already in that state: nothing to do, and nothing to say about it.
            else if (anyUnread === (command === 'unread')) return true;
            else void setUnread(mails, command === 'unread');
            return true;
          },
          ...(!inTrash && {
            blockedReason: {
              forward: forwardDisabled || undefined,
              reply: replyDisabled || undefined,
            },
            forward: () => startComposing('forward'),
            reply: () => startComposing('reply'),
            replyAll: () => startComposing('replyAll'),
          }),
        };

    const toggle = (mail: AgentMailRow) => {
      const opening = !open.has(mail.id);
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(mail.id)) next.delete(mail.id);
        else next.add(mail.id);
        return next;
      });
      if (opening && mail.isUnread && !disabled) void setUnread([mail], false);
    };

    return (
      <Flexbox gap={12} padding={4} ref={rootRef}>
        <MailHotkeyTarget kind={'detail'} target={hotkeys} />
        <MailDetailToolbar
          forwardDisabledReason={forwardDisabled || undefined}
          hasNext={hasNext}
          hasPrevious={hasPrevious}
          replyDisabledReason={replyDisabled || undefined}
          starred={starred.length > 0}
          unread={anyUnread}
          onForward={readOnly || inTrash ? undefined : () => startComposing('forward')}
          onNext={onNext}
          onPrevious={onPrevious}
          onReply={readOnly || inTrash ? undefined : () => startComposing('reply')}
          onReplyAll={readOnly || inTrash ? undefined : () => startComposing('replyAll')}
          onRestore={readOnly || !inTrash ? undefined : () => void restore(mails)}
          onToggleRead={readOnly ? undefined : () => void setUnread(mails, !anyUnread)}
          onToggleStar={readOnly || inTrash ? undefined : toggleStar}
          onTrash={readOnly || inTrash ? undefined : () => void trash(mails)}
        />
        {released && (
          <Text fontSize={12} type={'secondary'}>
            {t('identity.inbox.detail.released')}
          </Text>
        )}
        <Flexbox horizontal align={'baseline'} gap={8}>
          <Text fontSize={16} weight={600}>
            {newest.subject || t('identity.inbox.noSubject')}
          </Text>
          {mails.length > 1 && (
            <Text fontSize={12} style={{ flexShrink: 0 }} type={'secondary'}>
              {t('identity.inbox.detail.count', { count: mails.length })}
            </Text>
          )}
        </Flexbox>
        {/* Touching the mail itself is reading it; stepping past it with the toolbar is not. */}
        <Flexbox
          data-testid={'mail-conversation'}
          gap={8}
          onKeyDownCapture={() => setReadArmed(true)}
          onPointerDownCapture={() => setReadArmed(true)}
        >
          {rows.map((row) => {
            if (row.kind === 'fold') {
              return (
                <Button
                  block
                  data-testid={'mail-fold'}
                  key={`fold-${row.firstHiddenIndex}`}
                  size={'small'}
                  type={'text'}
                  onClick={() => setUnfolded(true)}
                >
                  {t('identity.inbox.detail.showMore', { count: row.count })}
                </Button>
              );
            }
            const mail = byId.get(row.id)!;
            return (
              <div key={mail.id} ref={mail.id === focusId ? focusRef : undefined}>
                <ConversationMessage
                  expanded={open.has(mail.id)}
                  mail={mail}
                  onToggle={() => toggle(mail)}
                  onTrash={readOnly || inTrash ? undefined : () => void trash([mail])}
                  onForward={
                    readOnly || inTrash || forwardDisabled
                      ? undefined
                      : () => startComposing('forward', mail.id)
                  }
                  onToggleStar={
                    readOnly || inTrash ? undefined : () => void setStarred([mail], !mail.starredAt)
                  }
                />
              </div>
            );
          })}
        </Flexbox>
        {composing && composeSource && composeAccount && !readOnly && !inTrash && (
          <div ref={composerRef}>
            <MailComposer
              inline
              account={composeAccount}
              agentId={agentId}
              draft={composing.draft}
              key={`${composing.mode}:${composing.draft?.id ?? composing.sourceId}`}
              mode={composing.mode}
              refresh={() => Promise.all([mutate(), options.refresh()])}
              source={composeSource}
              onClose={stopComposing}
              onDraftCreated={(draftId) => onComposeChange(draftId)}
              onViewSent={onViewSent}
              onReopenDraft={(draftId) => {
                setComposing(undefined);
                onComposeChange(draftId);
              }}
            />
          </div>
        )}
        {/* The mail being answered left this view (trashed meanwhile); what was written is saved. */}
        {composing && pickedId && !composeSource && !readOnly && !inTrash && (
          <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
            <Text fontSize={12} type={'secondary'}>
              {t('identity.compose.sourceLeft')}
            </Text>
            <Button size={'small'} type={'text'} onClick={stopComposing}>
              {t('identity.compose.close')}
            </Button>
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

InboxMessageDetail.displayName = 'AgentInboxMessageDetail';

export default InboxMessageDetail;
