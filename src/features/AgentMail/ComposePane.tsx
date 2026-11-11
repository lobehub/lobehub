'use client';

import { Button, Center, Flexbox, Skeleton, Text } from '@lobehub/ui';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { agentAccountService, type AgentAccountView } from '@/services/agentAccount';

import InlineError from './InlineError';
import MailComposer from './MailComposer';
import type { SentMail } from './useComposer';

/** `?compose=new` opens a fresh mail; any other value is a draft's id. */
export const NEW_COMPOSE = 'new';

export const mailDraftKey = (id: string) => ['agent-mail-draft', id] as const;

/**
 * One draft, read fresh on every open (a cached copy may predate the last
 * save) and then left alone: the composer owns it from there.
 */
export const useMailDraft = (id?: string) =>
  useSWR(id ? mailDraftKey(id) : null, ([, draftId]) => agentAccountService.getMailDraft(draftId), {
    dedupingInterval: 0,
    revalidateOnMount: true,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
  });

export interface ComposePaneProps {
  /** The addresses still held; a draft's own may have been released since. */
  accounts: AgentAccountView[];
  agentId: string;
  composeId: string;
  /** The address on screen; a new mail goes out from it. */
  currentAccount?: AgentAccountView;
  onClose: () => void;
  onDraftCreated: (id: string) => void;
  /** A reply or forward draft continues inside the conversation it answers. */
  onOpenConversation: (sourceMailId: string, draftId: string) => void;
  onReopenDraft: (id: string) => void;
  onViewSent: (sent: SentMail) => void;
  refresh: () => Promise<unknown>;
}

/** Writing a new mail, or resuming a draft, in the reading pane's place. */
const ComposePane = ({
  accounts,
  agentId,
  composeId,
  currentAccount,
  onClose,
  onDraftCreated,
  onOpenConversation,
  onReopenDraft,
  onViewSent,
  refresh,
}: ComposePaneProps) => {
  const { t } = useTranslation('setting');
  const isNew = composeId === NEW_COMPOSE;
  const draft = useMailDraft(isNew ? undefined : composeId);
  const answers = draft.data && draft.data.mode !== 'compose' && draft.data.sourceMailId;

  useEffect(() => {
    if (answers && draft.data) onOpenConversation(draft.data.sourceMailId!, draft.data.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers]);

  if (!isNew && draft.error) {
    const gone = (draft.error as { data?: { code?: string } }).data?.code === 'NOT_FOUND';
    return gone ? (
      <Center gap={12} paddingBlock={48}>
        <Text type={'secondary'}>{t('identity.compose.error.draftGone')}</Text>
        <Button onClick={onClose}>{t('identity.inbox.detail.backToList')}</Button>
      </Center>
    ) : (
      <InlineError
        detail={draft.error instanceof Error ? draft.error.message : String(draft.error)}
        summary={t('identity.compose.loadFailed')}
        onRetry={() => void draft.mutate()}
      />
    );
  }

  if (!isNew && (!draft.data || draft.isValidating || answers)) {
    return (
      <Flexbox gap={12} padding={4}>
        <Skeleton height={32} width={'100%'} />
        <Skeleton height={160} width={'100%'} />
      </Flexbox>
    );
  }

  const account = isNew
    ? currentAccount
    : accounts.find((item) => item.id === draft.data!.accountId);

  if (!account) {
    return (
      <Center gap={12} paddingBlock={48}>
        <Text type={'secondary'}>{t('identity.compose.block.released')}</Text>
        <Button onClick={onClose}>{t('identity.inbox.detail.backToList')}</Button>
      </Center>
    );
  }

  return (
    <MailComposer
      account={account}
      agentId={agentId}
      draft={draft.data}
      // A forward or reply whose original is gone stays here, and says it cannot be sent.
      mode={draft.data?.mode ?? 'compose'}
      refresh={refresh}
      onClose={onClose}
      onDraftCreated={onDraftCreated}
      onReopenDraft={onReopenDraft}
      onViewSent={onViewSent}
    />
  );
};

export default ComposePane;
