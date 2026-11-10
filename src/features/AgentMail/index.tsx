'use client';

import { Center, Flexbox } from '@lobehub/ui';
import { useEffect, useState } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router';
import { useSWRConfig } from 'swr';
import urlJoin from 'url-join';

import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import AgentProfileTabs, { AGENT_PROFILE_TABS_CENTER_STYLE } from '@/features/AgentProfileTabs';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useServerConfigStore } from '@/store/serverConfig';
import { isMobileSurface } from '@/utils/mobileSurface';
import { StyleSheet } from '@/utils/styles';

import {
  type ConversationNeighbors,
  findNeighbors,
  nextSelectionAfterRemoval,
} from './conversation';
import InboxMessageDetail, { type InboxMessageDetailProps } from './InboxMessageDetail';
import InboxSection from './InboxSection';
import MailboxCard from './MailboxCard';
import MailboxEmptyState from './MailboxEmptyState';
import MailSplitView, { MailNavHeader } from './MailSplitView';
import { identityStyles } from './styles';
import { useMailbox, useOpenableChannel } from './useAgentIdentity';
import {
  mailCountsKey,
  mailFolderOf,
  type MailListItem,
  type MailView,
  parseMailView,
  useHasRetainedMail,
  useMailConversation,
  useMailList,
} from './useMailList';

const styles = StyleSheet.create({
  body: {
    display: 'flex',
    overflowY: 'auto',
    position: 'relative',
  },
});

interface AgentMailProps {
  agentId: string;
  /** Read-only viewer: addresses and mail stay readable, nothing can be opened or released. */
  disabled?: boolean;
}

/**
 * The agent's mail page: which mailbox is being read, and what has arrived.
 *
 * The open message lives in the URL, so a phone's back gesture leaves it and a
 * reload keeps it. A wide screen shows it beside the list; a phone gives it the
 * whole page.
 */
const MailPage = ({ agentId, disabled }: AgentMailProps) => {
  const { messageId } = useParams<{ messageId?: string }>();
  const navigate = useWorkspaceAwareNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseMailView(searchParams.get('folder'));
  const query = searchParams.get('q')?.trim() ?? '';
  const folder = query ? undefined : mailFolderOf(view);
  const composeId = searchParams.get('compose') ?? undefined;
  const mailbox = useMailbox(agentId, messageId, folder);
  const openable = useOpenableChannel();
  const configLoaded = useServerConfigStore((s) => s.serverConfigLoaded);
  const mobile = isMobileSurface();
  const mailPath = urlJoin('/agent', agentId, 'mail');
  const search = searchParams.toString();
  const noAddress = !!mailbox.data && !mailbox.current;
  // Releasing an address keeps the mail it received, so "no address" is not
  // "no mail": only a successful read finding nothing in Inbox, Sent or Trash
  // counts as nothing to show.
  const retained = useHasRetainedMail(agentId, noAddress);
  const noMail = noAddress && !retained.error && retained.data === false;
  const checkingMail = noAddress && !retained.error && retained.data === undefined;
  // Nothing to read and nothing this deployment could open, so there is no page.
  // Until the server config has loaded, an empty provider list is only the
  // default (a cold desktop start), not the deployment saying it has none.
  const unavailable = configLoaded && noMail && !openable;

  useEffect(() => {
    if (unavailable) navigate(urlJoin('/agent', agentId, 'profile'), { replace: true });
  }, [agentId, navigate, unavailable]);

  // The same SWR entries the list and the switcher read, so stepping and
  // writes stay in step with them without a request of their own.
  const accountIds = mailbox.accounts.map((account) => account.id);
  const list = useMailList({
    accountId: mailbox.current?.id,
    agentId,
    enabled: !!mailbox.data,
    query,
    view,
  });
  const { mutate: mutateCache } = useSWRConfig();
  const refresh = () => Promise.all([list.mutate(), mutateCache(mailCountsKey(accountIds))]);
  const location = useLocation();
  // Held until the URL open settles, which seeds it with the read it made.
  const conversation = useMailConversation(mailbox.data ? messageId : undefined, folder);
  const conversationIds = new Set(
    (conversation.data ?? []).flatMap((mail) =>
      mail.inboxMessageId ? [mail.id, mail.inboxMessageId] : [mail.id],
    ),
  );
  if (messageId) conversationIds.add(messageId);
  const found = findNeighbors(list.items ?? [], conversationIds);
  // A conversation whose row is briefly out of the list (reseated onto another
  // of its mails, or mid-write) keeps the neighbours it last had there.
  const [anchor, setAnchor] = useState<{ ids: string[]; neighbors: ConversationNeighbors }>();
  if (
    found.rowId &&
    (anchor?.neighbors.rowId !== found.rowId ||
      anchor.neighbors.nextId !== found.nextId ||
      anchor.neighbors.previousId !== found.previousId)
  ) {
    setAnchor({ ids: [...conversationIds], neighbors: found });
  }
  const neighbors: ConversationNeighbors = found.rowId
    ? found
    : anchor?.ids.some((id) => conversationIds.has(id))
      ? anchor.neighbors
      : {};

  // Moving between messages replaces the entry, so back leaves the mail page.
  const openMessage = (item: MailListItem) => {
    if (item.kind === 'draft') {
      navigate(`${mailPath}?folder=drafts&compose=${item.id}`, { replace: true });
      return;
    }
    // Pinned so the opened message does not have to be read to know its mailbox.
    mailbox.select(mailbox.current?.id);
    navigate(`${urlJoin(mailPath, item.id)}${search && `?${search}`}`, {
      replace: Boolean(messageId),
    });
  };

  /** Landing on a neighbour after a removal is automatic, so it is not read until touched. */
  const landOn = (id: string) => {
    // Pinned before the move: otherwise the landed-on mail resolves through the
    // URL open, which marks it read and defeats the deferral.
    mailbox.select(mailbox.current?.id);
    navigate(`${urlJoin(mailPath, id)}${search && `?${search}`}`, {
      replace: true,
      state: { deferRead: true },
    });
  };

  const openById = (id: string) => {
    mailbox.select(mailbox.current?.id);
    navigate(`${urlJoin(mailPath, id)}${search && `?${search}`}`, { replace: true });
  };

  const stepTo = async (direction: 'nextId' | 'previousId') => {
    let target = neighbors[direction];
    if (!target && direction === 'nextId' && list.hasMore) {
      target = findNeighbors(await list.loadNextPage(), conversationIds).nextId;
    }
    if (target) openById(target);
  };

  const closeMessage = () => navigate(`${mailPath}${search && `?${search}`}`, { replace: true });

  const detailProps: Omit<InboxMessageDetailProps, 'id'> = {
    accountId: mailbox.current?.id,
    accounts: mailbox.accounts,
    deferRead: Boolean((location.state as { deferRead?: boolean } | null)?.deferRead),
    disabled,
    folder,
    // Paging only helps once the open conversation is a loaded row to step from.
    hasNext: Boolean(neighbors.nextId) || (Boolean(neighbors.rowId) && list.hasMore),
    hasPrevious: Boolean(neighbors.previousId),
    onBack: closeMessage,
    onEmptied: () => {
      // A wide screen moves on to the next conversation; a phone returns to the list.
      const target = mobile ? undefined : nextSelectionAfterRemoval(neighbors);
      if (target) landOn(target);
      else closeMessage();
    },
    onGoToTrash: () => changeView('trash'),
    onNext: () => void stepTo('nextId'),
    onPrevious: () => void stepTo('previousId'),
    onReseated: landOn,
    onRestored: openById,
    refresh,
  };

  // The view stays; a search or an open message belongs to the address being left.
  const switchMailbox = (accountId: string) => {
    mailbox.select(accountId);
    navigate(view === 'inbox' ? mailPath : `${mailPath}?folder=${view}`, { replace: true });
  };

  const changeView = (next: MailView) => setSearchParams(next === 'inbox' ? {} : { folder: next });

  const changeQuery = (next: string) =>
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        if (next) params.set('q', next);
        else params.delete('q');
        return params;
      },
      { replace: true },
    );

  if (unavailable) return null;

  // Waits for the URL open to settle, so its read-mark lands before the detail reads.
  const detail = messageId && mailbox.data && (
    <InboxMessageDetail {...detailProps} id={messageId} key={messageId} />
  );

  const mailboxCard = (
    <MailboxCard agentId={agentId} disabled={disabled} mailbox={mailbox} onSwitch={switchMailbox} />
  );
  // Waits for the addresses, read successfully, so the list never flashes every
  // address's mail first: without them `accountId` would mean all of them.
  const inbox = !!mailbox.data && (
    <InboxSection
      accountId={mailbox.current?.id}
      accountIds={mailbox.accounts.map((account) => account.id)}
      agentId={agentId}
      disabled={disabled}
      query={query}
      selectedId={mobile ? undefined : messageId ? (found.rowId ?? messageId) : composeId}
      view={view}
      onOpen={openMessage}
      onQueryChange={changeQuery}
      onViewChange={changeView}
      onRemoved={(ids) => {
        // The row may stand for the open conversation under another of its mails' ids.
        if (messageId && ids.some((id) => conversationIds.has(id))) {
          navigate(`${mailPath}${search && `?${search}`}`, { replace: true });
        }
      }}
    />
  );

  // With no address there is nothing to list or read, so the offer takes the
  // whole page. Waits for a successful read: a failure must not look like "none".
  const emptyState = checkingMail ? (
    <Center flex={1} />
  ) : (
    noMail &&
    openable && (
      <Center flex={1} padding={24} style={{ minHeight: 0 }}>
        <MailboxEmptyState
          agentId={agentId}
          channel={openable}
          disabled={disabled}
          onProvisioned={mailbox.mutate}
        />
      </Center>
    )
  );

  return (
    <Flexbox height={'100%'} style={{ position: 'relative' }} width={'100%'}>
      {mobile ? (
        <>
          <NavHeader
            left={<AgentBreadcrumb agentId={agentId} />}
            // `relative` anchors the absolutely-centered switcher below.
            style={{ position: 'relative' }}
            styles={{
              // Center on the header midpoint (equal gaps), not the leftover track.
              center: AGENT_PROFILE_TABS_CENTER_STYLE,
              left: { minWidth: 0, paddingInlineStart: 8 },
            }}
          >
            <AgentProfileTabs active={'mail'} agentId={agentId} />
          </NavHeader>
          {emptyState || (
            <Flexbox flex={1} style={styles.body} width={'100%'}>
              <WideScreenContainer>
                <Flexbox gap={24} paddingBlock={16}>
                  {mailboxCard}
                  {inbox}
                </Flexbox>
              </WideScreenContainer>
            </Flexbox>
          )}
        </>
      ) : emptyState ? (
        <>
          <MailNavHeader />
          {emptyState}
        </>
      ) : (
        <MailSplitView detail={detail} inbox={inbox} mailbox={mailboxCard} messageId={messageId} />
      )}
      {/* Laid over the list instead of replacing it, so back returns to the same scroll. */}
      {mobile && messageId && (
        <Flexbox className={identityStyles.mobileDetail}>
          <NavHeader />
          <Flexbox flex={1} padding={16} style={styles.body} width={'100%'}>
            {detail}
          </Flexbox>
        </Flexbox>
      )}
    </Flexbox>
  );
};

/** Keyed so a selected mailbox never carries over to another agent. */
const AgentMail = (props: AgentMailProps) => <MailPage key={props.agentId} {...props} />;

export default AgentMail;
