'use client';

import type { AgentMailFolder } from '@lobechat/types';
import { Button, Center, Flexbox, Skeleton, Text } from '@lobehub/ui';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AgentAccountView, AgentMailRow } from '@/services/agentAccount';

import {
  buildConversationRows,
  idsToMarkReadOnOpen,
  initialExpandedIds,
  initialFocusId,
} from './conversation';
import ConversationMessage from './ConversationMessage';
import InlineError from './InlineError';
import MailDetailToolbar from './MailDetailToolbar';
import { useConversation, type UseConversationOptions } from './useConversation';

export interface InboxMessageDetailProps extends UseConversationOptions {
  /** The addresses still held; the mail's own may have been released since. */
  accounts: Pick<AgentAccountView, 'id' | 'status'>[];
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
  onNext: () => void;
  onPrevious: () => void;
}

/**
 * One conversation, read by id rather than taken from a possibly stale list row.
 * Older mail collapses to a summary line; the newest and anything unread open.
 */
const InboxMessageDetail = memo<InboxMessageDetailProps>(
  ({
    accounts,
    deferRead,
    disabled,
    folder,
    hasNext,
    hasPrevious,
    id,
    onBack,
    onNext,
    onPrevious,
    ...options
  }) => {
    const { t } = useTranslation('setting');
    const {
      data: mails,
      error,
      isLoading,
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
    // Opening from the list or by stepping reads here; a link opened cold is read
    // before the page loads (`useMailbox`). A read-only viewer reads nothing.
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

    if (isLoading || !mails) {
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
      <Flexbox gap={12} padding={4}>
        <MailDetailToolbar
          hasNext={hasNext}
          hasPrevious={hasPrevious}
          starred={starred.length > 0}
          unread={anyUnread}
          onNext={onNext}
          onPrevious={onPrevious}
          onRestore={readOnly || !inTrash ? undefined : () => void restore(mails)}
          onToggleRead={readOnly ? undefined : () => void setUnread(mails, !anyUnread)}
          onTrash={readOnly || inTrash ? undefined : () => void trash(mails)}
          onToggleStar={
            readOnly || inTrash
              ? undefined
              : // Unstar clears every star; star marks the newest, as a mail product does.
                () =>
                  void (starred.length > 0
                    ? setStarred(starred, false)
                    : setStarred([newest], true))
          }
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
                  onToggleStar={
                    readOnly || inTrash ? undefined : () => void setStarred([mail], !mail.starredAt)
                  }
                />
              </div>
            );
          })}
        </Flexbox>
      </Flexbox>
    );
  },
);

InboxMessageDetail.displayName = 'AgentInboxMessageDetail';

export default InboxMessageDetail;
