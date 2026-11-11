'use client';

import { HotkeyEnum } from '@lobechat/const/hotkeys';
import { ActionIcon, Button, Center, Flexbox, Tooltip } from '@lobehub/ui';
import { useSize } from 'ahooks';
import { PenLine } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

import { SEND_BLOCK_KEYS, sendBlockOf, useSendBlockVersion } from './compose';
import ComposePane, { NEW_COMPOSE } from './ComposePane';
import {
  type ConversationNeighbors,
  findNeighbors,
  nextSelectionAfterRemoval,
} from './conversation';
import InboxMessageDetail, { type InboxMessageDetailProps } from './InboxMessageDetail';
import InboxSection from './InboxSection';
import MailboxCard from './MailboxCard';
import MailboxEmptyState from './MailboxEmptyState';
import { SendBlockNotice } from './MailComposer';
import { MailHotkeys, useMailHotkeyHint } from './mailHotkeys';
import MailSplitView, { MailNavHeader } from './MailSplitView';
import { identityStyles } from './styles';
import { useMailbox, useOpenableChannel } from './useAgentIdentity';
import type { SentMail } from './useComposer';
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

/** Below this page width the list and the open mail take turns (spec §8). */
const NARROW_MAIL_WIDTH = 768;

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
  const { t } = useTranslation('setting');
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
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useSize(rootRef)?.width;
  // A phone is always one column; a desktop window only once it is too narrow
  // for two. Before the first measure the window's width stands in (the page
  // is never wider), so a narrow window does not flash two columns on load.
  const narrow =
    mobile ||
    (width || (typeof window === 'undefined' ? 0 : window.innerWidth)) < NARROW_MAIL_WIDTH;
  const mailPath = urlJoin('/agent', agentId, 'mail');
  // A draft open in the URL belongs to the mail it answers, so moving to
  // another mail, or back to the list, leaves it behind (it saves on unmount).
  const search = (() => {
    const params = new URLSearchParams(searchParams);
    params.delete('compose');
    return params.toString();
  })();
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

  /** The URL's `compose`: which draft is open, so a reload resumes it. */
  const withCompose = (id?: string) => {
    const params = new URLSearchParams(searchParams);
    if (id) params.set('compose', id);
    else params.delete('compose');
    const next = params.toString();
    return next && `?${next}`;
  };

  // A new mail is keyed `new` until its first save names it. Swapping in that
  // id must not remount the composer the person is typing in.
  const [createdDraftId, setCreatedDraftId] = useState<string>();
  // Only while that composer is on screen: once the URL names something else
  // (another view, the list, another draft), opening the draft again reads it.
  if (createdDraftId && composeId !== createdDraftId && composeId !== NEW_COMPOSE) {
    setCreatedDraftId(undefined);
  }
  const paneComposeId = composeId && composeId === createdDraftId ? NEW_COMPOSE : composeId;

  const startCompose = () => {
    setCreatedDraftId(undefined);
    navigate(`${mailPath}${withCompose(NEW_COMPOSE)}`, { replace: Boolean(composeId) });
  };

  const closeCompose = () => {
    setCreatedDraftId(undefined);
    navigate(`${messageId ? urlJoin(mailPath, messageId) : mailPath}${withCompose()}`, {
      replace: true,
    });
    // The editor takes focus with it; it goes back to the button that opened it.
    // Focus still inside the closing page (its back button) counts as lost too.
    setTimeout(() => {
      const active = document.activeElement;
      const lost =
        !active ||
        active === document.body ||
        !active.isConnected ||
        Boolean(active.closest('[data-mail-narrow-detail]'));
      if (lost)
        rootRef.current?.querySelector<HTMLElement>('[data-testid="mail-compose"]')?.focus();
    }, 0);
  };

  const viewSent = (sent: SentMail) =>
    navigate(`${sent.mailId ? urlJoin(mailPath, sent.mailId) : mailPath}?folder=sent`);

  useSendBlockVersion();
  const sendBlock = mailbox.current ? sendBlockOf(mailbox.current) : undefined;

  const detailProps: Omit<InboxMessageDetailProps, 'id'> = {
    accountId: mailbox.current?.id,
    listRowId: neighbors.rowId,
    accounts: mailbox.accounts,
    agentId,
    composeId,
    deferRead: Boolean((location.state as { deferRead?: boolean } | null)?.deferRead),
    disabled,
    folder,
    // Paging only helps once the open conversation is a loaded row to step from.
    hasNext: Boolean(neighbors.nextId) || (Boolean(neighbors.rowId) && list.hasMore),
    hasPrevious: Boolean(neighbors.previousId),
    onBack: closeMessage,
    onComposeChange: (id) =>
      navigate(`${urlJoin(mailPath, messageId ?? '')}${withCompose(id)}`, { replace: true }),
    onEmptied: () => {
      // A wide screen moves on to the next conversation; one column returns to the list.
      const target = narrow ? undefined : nextSelectionAfterRemoval(neighbors);
      if (target) landOn(target);
      else closeMessage();
    },
    onGoToTrash: () => changeView('trash'),
    onNext: () => void stepTo('nextId'),
    onPrevious: () => void stepTo('previousId'),
    onReseated: landOn,
    onRestored: openById,
    onViewSent: viewSent,
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

  const composeHotkey = useMailHotkeyHint(HotkeyEnum.MailCompose);

  if (unavailable) return null;

  // Waits for the URL open to settle, so the pane starts from the read it seeded.
  // Keyed by view too: Inbox and Trash hold different mails of one conversation.
  const composePane = !messageId && paneComposeId && mailbox.data && (
    <ComposePane
      accounts={mailbox.accounts}
      agentId={agentId}
      composeId={paneComposeId}
      currentAccount={mailbox.current}
      key={paneComposeId}
      refresh={refresh}
      onClose={closeCompose}
      onReopenDraft={(id) => navigate(`${mailPath}${withCompose(id)}`, { replace: true })}
      onViewSent={viewSent}
      onDraftCreated={(id) => {
        setCreatedDraftId(id);
        navigate(`${mailPath}${withCompose(id)}`, { replace: true });
      }}
      onOpenConversation={(sourceMailId, draftId) =>
        navigate(`${urlJoin(mailPath, sourceMailId)}${withCompose(draftId)}`, { replace: true })
      }
    />
  );

  const detail =
    (messageId && mailbox.data && (
      <InboxMessageDetail {...detailProps} id={messageId} key={`${folder}:${messageId}`} />
    )) ||
    composePane;

  // Kept when the address cannot send, disabled, so the ability stays visible.
  const composeLabel = t('identity.compose.action.compose');
  const composeTitle = sendBlock ? t(SEND_BLOCK_KEYS[sendBlock]) : composeLabel;
  const composeAction =
    !disabled &&
    mailbox.current &&
    (narrow ? (
      <ActionIcon
        aria-label={composeLabel}
        data-testid={'mail-compose'}
        disabled={Boolean(sendBlock)}
        icon={PenLine}
        title={composeTitle}
        tooltipProps={sendBlock ? undefined : { hotkey: composeHotkey }}
        onClick={startCompose}
      />
    ) : (
      // A disabled button gets no pointer events, so its reason stays a plain title.
      <Tooltip hotkey={composeHotkey} open={sendBlock ? false : undefined} title={composeTitle}>
        <Button
          data-testid={'mail-compose'}
          disabled={Boolean(sendBlock)}
          icon={PenLine}
          size={'small'}
          title={sendBlock ? composeTitle : undefined}
          type={'primary'}
          onClick={startCompose}
        >
          {composeLabel}
        </Button>
      </Tooltip>
    ));

  // Always on screen under the address, not behind a tooltip a phone cannot hover.
  const sendNotice = !disabled && mailbox.current && sendBlock && (
    <SendBlockNotice account={mailbox.current} block={sendBlock} />
  );

  const mailboxCard = (
    <Flexbox gap={8}>
      <MailboxCard
        agentId={agentId}
        disabled={disabled}
        mailbox={mailbox}
        onSwitch={switchMailbox}
      />
      {sendNotice}
    </Flexbox>
  );
  // Waits for the addresses, read successfully, so the list never flashes every
  // address's mail first: without them `accountId` would mean all of them.
  const inbox = !!mailbox.data && (
    <InboxSection
      accountId={mailbox.current?.id}
      accountIds={mailbox.accounts.map((account) => account.id)}
      agentId={agentId}
      covered={narrow && Boolean(messageId || composePane)}
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

  const page = (
    <Flexbox height={'100%'} ref={rootRef} style={{ position: 'relative' }} width={'100%'}>
      {mobile ? (
        <>
          <NavHeader
            left={<AgentBreadcrumb agentId={agentId} />}
            right={composeAction}
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
        <MailSplitView
          action={composeAction}
          composing={Boolean(composePane)}
          detail={detail}
          inbox={inbox}
          mailbox={mailboxCard}
          messageId={messageId}
          narrow={narrow}
          onBack={messageId ? closeMessage : closeCompose}
        />
      )}
      {/* Laid over the list instead of replacing it, so back returns to the same scroll. */}
      {mobile && (messageId || composePane) && (
        <Flexbox className={identityStyles.mobileDetail}>
          <NavHeader />
          <Flexbox flex={1} padding={16} style={styles.body} width={'100%'}>
            {detail}
          </Flexbox>
        </Flexbox>
      )}
    </Flexbox>
  );

  return (
    <MailHotkeys
      page={{
        back: () => {
          if (messageId) closeMessage();
          else if (composePane) closeCompose();
          else return false;
          return true;
        },
        // A `g` key goes to that view's list, leaving the open mail, as in Gmail;
        // on one column the mail would otherwise keep covering the list.
        changeView: (next) => navigate(next === 'inbox' ? mailPath : `${mailPath}?folder=${next}`),
        compose: !disabled && mailbox.current && !sendBlock ? startCompose : undefined,
        composeBlockedReason: !disabled && sendBlock ? t(SEND_BLOCK_KEYS[sendBlock]) : undefined,
      }}
    >
      {page}
    </MailHotkeys>
  );
};

/** Keyed so a selected mailbox never carries over to another agent. */
const AgentMail = (props: AgentMailProps) => <MailPage key={props.agentId} {...props} />;

export default AgentMail;
