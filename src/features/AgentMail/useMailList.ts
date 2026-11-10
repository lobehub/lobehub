import type {
  AgentInboxMessage,
  AgentMailAddress,
  AgentMailDirection,
  AgentMailFolder,
} from '@lobechat/types';
import { useMemo } from 'react';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';

import {
  agentAccountService,
  type AgentMailConversationRow,
  type AgentMailDraftRow,
  type AgentMailRow,
} from '@/services/agentAccount';

import { applyMailWrites, useMailWritesStore } from './mailWrites';

/** One page of a view. Stays under the server's per-request cap (100). */
export const MAIL_PAGE_SIZE = 50;

/**
 * Deliveries land from outside — a webhook, not this tab — so a person
 * watching for a verification email must see it without refocusing the
 * window. SWR pauses the poll while the tab is hidden.
 */
export const MAIL_REFRESH_INTERVAL_MS = 30_000;

export const MAIL_VIEWS = ['inbox', 'sent', 'drafts', 'starred', 'trash'] as const;
export type MailView = (typeof MAIL_VIEWS)[number];

export const parseMailView = (value: string | null): MailView =>
  MAIL_VIEWS.find((view) => view === value) ?? 'inbox';

/** The mail folder behind a view; drafts are not mail yet and have none. */
export const mailFolderOf = (view: MailView): AgentMailFolder | undefined =>
  view === 'drafts' ? undefined : view;

/** One list row, whichever view it came from. */
export interface MailListItem {
  accountId: string;
  /** What the view sorts by; also the row's cursor. */
  at: Date;
  direction?: AgentMailDirection;
  hasAttachments: boolean;
  id: string;
  isStarred: boolean;
  isUnread: boolean;
  kind: 'draft' | 'mail';
  mailCount: number;
  /** Who the row is about; `undefined` is a draft with nobody to send to yet. */
  party?: string;
  preview: string;
  subject: string | null;
}

const nameOf = (address: AgentMailAddress) => address.name || address.address;

const recipientsOf = (to: AgentMailAddress[]) => {
  if (to.length === 0) return undefined;
  return to.length === 1 ? nameOf(to[0]) : `${nameOf(to[0])} +${to.length - 1}`;
};

const fromConversation = (row: AgentMailConversationRow): MailListItem => ({
  accountId: row.accountId,
  at: new Date(row.sortAt),
  direction: row.direction,
  hasAttachments: row.hasAttachments,
  id: row.id,
  isStarred: row.isStarred,
  isUnread: row.isUnread,
  kind: 'mail',
  mailCount: row.mailCount,
  party: row.direction === 'outbound' ? recipientsOf(row.to) : row.fromName || row.fromAddress,
  preview: row.preview,
  subject: row.subject,
});

const fromDraft = (row: AgentMailDraftRow): MailListItem => ({
  accountId: row.accountId,
  at: new Date(row.updatedAt),
  hasAttachments: false,
  id: row.id,
  isStarred: false,
  isUnread: false,
  kind: 'draft',
  mailCount: 1,
  party: recipientsOf(row.to),
  preview: row.text.slice(0, 200),
  subject: row.subject,
});

interface MailListParams {
  /**
   * The address on screen. `undefined` lists every address of the agent, which
   * only the page with no address left asks for: mail a released address
   * received stays readable.
   */
  accountId?: string;
  agentId: string;
  /** Off while the addresses are loading, so the list never flashes every address's mail. */
  enabled?: boolean;
  query: string;
  view: MailView;
}

interface MailPage {
  items: MailListItem[];
  /** A search read only its best matches and there were more. */
  truncated: boolean;
}

const fetchPage = async (
  params: Omit<MailListParams, 'enabled'>,
  before: { at: Date; id: string } | null,
): Promise<MailPage> => {
  const { accountId, agentId, query, view } = params;
  const scope = { accountId, agentId, limit: MAIL_PAGE_SIZE };
  const cursor = before ? { id: before.id, sortAt: before.at } : undefined;

  if (query) {
    const result = await agentAccountService.searchMail({ ...scope, before: cursor, query });
    return { items: result.items.map(fromConversation), truncated: result.truncated };
  }

  if (view === 'drafts') {
    const rows = await agentAccountService.listMailDrafts({
      ...scope,
      before: before ? { id: before.id, updatedAt: before.at } : undefined,
    });
    return { items: rows.map(fromDraft), truncated: false };
  }

  const rows = await agentAccountService.listMail({ ...scope, before: cursor, folder: view });
  return { items: rows.map(fromConversation), truncated: false };
};

/**
 * One view of one address, newest first.
 *
 * Paged by a keyset cursor (the last row of the previous page), so every
 * request asks for one fixed-size page however far back the user scrolls,
 * and rows already on screen stay where they are.
 */
export const useMailList = ({
  accountId,
  agentId,
  enabled = true,
  query,
  view,
}: MailListParams) => {
  const list = useSWRInfinite(
    (pageIndex, previous: MailPage | null) => {
      if (!agentId || !enabled) return null;
      const base = ['agent-mail-list', agentId, accountId, view, query] as const;
      if (pageIndex === 0) return [...base, null] as const;
      const last = previous?.items.at(-1);
      // The previous page came back short: there is nothing older to ask for.
      if (!last || previous!.items.length < MAIL_PAGE_SIZE) return null;
      return [...base, { at: last.at, id: last.id }] as const;
    },
    ([, agent, account, listView, keyword, before]) =>
      fetchPage({ accountId: account, agentId: agent, query: keyword, view: listView }, before),
    {
      // A new keyword keeps the last results on screen instead of flashing a skeleton.
      keepPreviousData: Boolean(query),
      // A search is a question asked once; re-running full-text search on a timer
      // costs more than new mail landing in it is worth. Refresh still re-asks.
      refreshInterval: query ? 0 : MAIL_REFRESH_INTERVAL_MS,
    },
  );

  const writes = useMailWritesStore((state) => state.writes);
  const pages = list.data;
  const items = useMemo(
    () =>
      pages
        ? applyMailWrites(
            pages.flatMap((page) => page.items),
            writes,
          )
        : undefined,
    [pages, writes],
  );

  return {
    error: list.error,
    /** The last page came back full, so the view may hold older mail. */
    hasMore: (pages?.at(-1)?.items.length ?? 0) >= MAIL_PAGE_SIZE,
    isLoading: list.isLoading,
    isLoadingMore: list.isValidating && list.size > (pages?.length ?? 0),
    isValidating: list.isValidating,
    items,
    /** Fetch the next page without disturbing what is already on screen. */
    loadMore: () => void list.setSize((size) => size + 1),
    /** Without arguments this revalidates every loaded page, which a write needs. */
    mutate: list.mutate,
    /** The search stopped at its best matches; refining the words finds the rest. */
    truncated: pages?.some((page) => page.truncated) ?? false,
  };
};

/** The server's cap on addresses per counts request. */
const MAX_COUNT_IDS = 100;

export interface MailCounts {
  drafts: number;
  unread: number;
}

/**
 * Every address's counts in one request, so the switcher can say where new
 * mail is waiting. Shared by the switcher and the views, which ask with the
 * same ids and so share one cache entry and one poll.
 */
export const useMailCounts = (accountIds: string[]) =>
  useSWR(
    accountIds.length > 0 ? ['agent-mail-account-counts', accountIds.join()] : null,
    async ([, joined]) => {
      const ids = joined.split(',');
      const batches: string[][] = [];
      for (let index = 0; index < ids.length; index += MAX_COUNT_IDS) {
        batches.push(ids.slice(index, index + MAX_COUNT_IDS));
      }
      const rows = (
        await Promise.all(batches.map((batch) => agentAccountService.getMailAccountCounts(batch)))
      ).flat();
      return Object.fromEntries(
        rows.map(({ accountId, drafts, unread }) => [accountId, { drafts, unread }]),
      ) as Record<string, MailCounts>;
    },
    { refreshInterval: MAIL_REFRESH_INTERVAL_MS },
  );

/** Views that can hold mail a released address received; Starred is inside Inbox and Sent. */
const RETAINED_FOLDERS = ['inbox', 'sent', 'trash'] as const;

/**
 * Whether any mail is left across the agent's addresses, released ones
 * included: `undefined` until known. Only asked once no address is left.
 */
export const useHasRetainedMail = (agentId: string, enabled: boolean) =>
  useSWR(agentId && enabled ? ['agent-mail-retained', agentId] : null, async ([, agent]) => {
    const views = await Promise.all(
      RETAINED_FOLDERS.map((folder) =>
        agentAccountService.listMail({ agentId: agent, folder, limit: 1 }),
      ),
    );
    return views.some((rows) => rows.length > 0);
  });

const formatAddress = (name: string | null | undefined, address: string) =>
  name ? `${name} <${address}>` : address;

const toMessage = (row: AgentMailRow): AgentInboxMessage => ({
  accountId: row.accountId,
  agentId: row.agentId,
  attachments: row.attachments ?? [],
  codes: row.codes ?? [],
  createdAt: row.createdAt,
  from: formatAddress(row.fromName, row.fromAddress),
  id: row.id,
  preview: row.text.slice(0, 200),
  readAt: row.isUnread ? null : row.deliveredAt,
  receivedAt: row.deliveredAt,
  sourceType: 'mail',
  subject: row.subject,
  text: row.text,
  threadKey: row.threadKey,
  to: row.to.map((to) => formatAddress(to.name, to.address)).join(', '),
});

/** One mail by id, or `null` when it is gone. Trash is its own view, so it needs the folder. */
export const readMailMessage = async (
  id: string,
  folder?: AgentMailFolder,
): Promise<AgentInboxMessage | null> => {
  const rows = await agentAccountService.getMailConversation({ folder, id });
  const row = rows.find((mail) => mail.id === id);
  return row ? toMessage(row) : null;
};

/** One stored mail, read by id rather than taken from a possibly stale list row. */
export const useMailMessage = (id?: string, folder?: AgentMailFolder) =>
  useSWR(id ? ['agent-mail-message', id, folder] : null, ([, messageId, view]) =>
    readMailMessage(messageId, view),
  );
