import type {
  AgentMailAddress,
  AgentMailAttachment,
  AgentMailDirection,
  AgentMailFolder,
} from '@lobechat/types';
import type { SQLWrapper } from 'drizzle-orm';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { FtsSearchCandidateSource } from '../repositories/ftsSearch/types';
import type { AgentMailItem, NewAgentMail } from '../schemas';
import { agentInboxMessages, agentMails } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { agentUsableBy } from '../utils/agent-access';
import { normalizeBm25MatchQuery, SAFE_BM25_QUERY_OPTIONS } from '../utils/bm25';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

/**
 * Secret-shaped fragments of a source mail, as Postgres regular expressions
 * (passed as parameters). See {@link AgentMailModel.findSecretRepeatedFromOtherSender}.
 */
const SECRET_URL_PATTERN = String.raw`(https?://[^]<>"')[:space:]]+)`;
const SECRET_LONG_TOKEN_PATTERN = String.raw`([0-9A-Za-z_+./=-]{20,})`;
const SECRET_ALNUM_RUN_PATTERN = String.raw`([0-9A-Za-z]{6,})`;

export interface RecordAgentMailParams {
  accountId: string;
  agentId: string;
  attachments?: AgentMailAttachment[];
  bcc?: AgentMailAddress[];
  cc?: AgentMailAddress[];
  codes?: string[];
  deliveredAt: Date;
  direction: AgentMailDirection;
  fromAddress: string;
  fromName?: string | null;
  inReplyTo?: string | null;
  messageId?: string | null;
  provider: string;
  providerMessageId: string;
  references?: string[];
  replyTo?: AgentMailAddress[];
  signalId?: string | null;
  subject?: string | null;
  text: string;
  threadKey?: string | null;
  to?: AgentMailAddress[];
}

export interface RecordAgentMailResult {
  /** False when this provider message was already recorded. */
  created: boolean;
  mail: AgentMailItem;
}

/** Newest first, strictly after the previous page's last conversation. */
export interface AgentMailCursor {
  id: string;
  sortAt: Date;
}

export interface ListAgentMailConversationsParams {
  accountId?: string;
  agentId: string;
  before?: AgentMailCursor;
  /** Omitted with `mailIds`: everything that is not trashed. */
  folder?: AgentMailFolder;
  limit?: number;
  /**
   * Narrows the view to these mails — a search's matches. Conversations are
   * then built from the matching mails only.
   */
  mailIds?: string[];
}

export interface SearchAgentMailConversationsParams {
  accountId?: string;
  agentId: string;
  before?: AgentMailCursor;
  limit?: number;
  /** Words looked for in the subject, sender, recipients and body. */
  query: string;
}

export interface SearchAgentMailConversationsResult {
  items: Awaited<ReturnType<AgentMailModel['listConversations']>>;
  /**
   * The search read only its best {@link AGENT_MAIL_SEARCH_POOL} matches and
   * there were more; refining the words finds the rest.
   */
  truncated: boolean;
}

/** How many matching mails one search reads, best first; its pages are built from them. */
export const AGENT_MAIL_SEARCH_POOL = 200;

/** The BM25 match text for `query`, or nothing when every word is one the parser drops. */
const bm25MatchTextOf = (query: string): string | undefined => {
  try {
    return normalizeBm25MatchQuery(query, SAFE_BM25_QUERY_OPTIONS);
  } catch {
    return undefined;
  }
};

/** BM25 fields of `agent_mails_bm25_idx`; recipients are its JSON fields. */
const BM25_MAIL_FIELDS = [
  'subject',
  'from_address',
  'from_name',
  'text',
  'to.address',
  'to.name',
  'cc.address',
  'cc.name',
];

/** A mail a purge wiped, with the signal it arrived as (none for sent mail). */
export interface AgentMailPurged {
  id: string;
  signalId: string | null;
}

/** One address's announced numbers, for the address list. */
export interface AgentMailAccountCounts {
  accountId: string;
  unread: number;
}

/** What is enough to delete a message's provider-side copy. */
export interface AgentMailPurgeTarget {
  accountId: string;
  agentId: string;
  id: string;
  providerMessageId: string;
}

const inboxItemOfMail = and(
  eq(agentInboxMessages.sourceType, 'mail'),
  eq(agentInboxMessages.sourceId, agentMails.id),
);

/**
 * Unread as a person sees it: asked to see it unread, or received and not yet
 * read. Sent mail has no inbox item and starts read. Agent paths ignore this
 * and keep reading `read_at`, which is what wakes key off.
 */
const isUnread = sql<boolean>`(${agentMails.markedUnreadAt} is not null or (${agentMails.direction} = 'inbound' and ${agentInboxMessages.readAt} is null))`;

/** A later mail of the same conversation, when looking for each one's newest. */
const newerMails = alias(agentMails, 'newer_mails');

type AgentMailTable = typeof agentMails | typeof newerMails;

const folderFilter = (folder: AgentMailFolder | undefined, t: AgentMailTable = agentMails) => {
  switch (folder) {
    case 'inbox': {
      return and(eq(t.direction, 'inbound'), isNull(t.trashedAt));
    }
    case 'sent': {
      return and(eq(t.direction, 'outbound'), isNull(t.trashedAt));
    }
    case 'starred': {
      return and(isNotNull(t.starredAt), isNull(t.trashedAt));
    }
    case 'trash': {
      return isNotNull(t.trashedAt);
    }
    default: {
      return isNull(t.trashedAt);
    }
  }
};

/** Which of a table's mails a list shows, short of ownership. */
const viewFilter = (params: ListAgentMailConversationsParams, t: AgentMailTable = agentMails) =>
  and(
    isNull(t.purgedAt),
    folderFilter(params.folder, t),
    params.mailIds ? inArray(t.id, params.mailIds) : undefined,
  );

/**
 * How long a purge holds a mail while its provider copy is deleted. A live purge
 * finishes in seconds; the lease only ever expires on a worker that died.
 */
export const PURGE_CLAIM_LEASE_SECONDS = 5 * 60;

/** No purge is deleting the provider copy right now. */
const purgeClaimFree = () =>
  or(
    isNull(agentMails.purgeClaimedAt),
    lt(agentMails.purgeClaimedAt, sql`now() - make_interval(secs => ${PURGE_CLAIM_LEASE_SECONDS})`),
  );

/** Lowercased and trimmed, the way `from_address` is stored and compared. */
export const normalizeMailAddress = (address: string): string => address.trim().toLowerCase();

/**
 * The secrets a mail carries: links, long tokens, and runs of six or more
 * letters and digits that mix both — lowercased, separators stripped. See
 * {@link AgentMailModel.findSecretRepeatedFromOtherSender}.
 */
const secretSource = (subject: typeof agentMails.subject, text: typeof agentMails.text) => {
  const source = sql`coalesce(${subject}, '') || ' ' || ${text}`;

  return sql`
    select lower(regexp_replace(m[1], '[^0-9A-Za-z]', '', 'g')) as secret
    from regexp_matches(${source}, ${SECRET_URL_PATTERN}, 'g') as m
    union
    select lower(regexp_replace(m[1], '[^0-9A-Za-z]', '', 'g'))
    from regexp_matches(${source}, ${SECRET_LONG_TOKEN_PATTERN}, 'g') as m
    union
    select lower(m[1])
    from regexp_matches(${source}, ${SECRET_ALNUM_RUN_PATTERN}, 'g') as m
    where m[1] ~ '[0-9]' and m[1] ~ '[A-Za-z]'
  `;
};

/**
 * Mail an agent's mail accounts received or sent.
 *
 * Inbound mail is recorded by the inbound edge (unscoped, before any user is
 * known); sent mail by the account tool after the provider accepted it. Reads
 * are scoped like the inbox: workspace AND the owning agent's visibility,
 * because mail carries whatever outsiders sent the agent, codes included.
 */
export class AgentMailModel {
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;

  private ftsSearchCandidateSource?: FtsSearchCandidateSource;

  /**
   * `ftsSearchCandidateSource` is the deployment's full-text search
   * (`createFtsSearchRepo`); only {@link searchConversations} needs it.
   */
  constructor(
    db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
    ftsSearchCandidateSource?: FtsSearchCandidateSource,
  ) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.ftsSearchCandidateSource = ftsSearchCandidateSource;
  }

  private ownership = () => {
    const ctx = { userId: this.userId, workspaceId: this.workspaceId };

    return and(
      buildWorkspaceWhere(ctx, agentMails),
      agentUsableBy(this.db, agentMails.agentId, ctx),
    )!;
  };

  /**
   * Record one message. Idempotent on `(account_id, provider_message_id)`: the
   * same provider message recorded again returns the stored row.
   */
  static record = async (
    db: LobeChatDatabase,
    params: RecordAgentMailParams,
    scope: { userId: string; workspaceId?: string },
  ): Promise<RecordAgentMailResult> => {
    const values = buildWorkspacePayload(scope, {
      accountId: params.accountId,
      agentId: params.agentId,
      attachments: params.attachments ?? [],
      bcc: params.bcc ?? [],
      cc: params.cc ?? [],
      codes: params.codes ?? [],
      deliveredAt: params.deliveredAt,
      direction: params.direction,
      fromAddress: normalizeMailAddress(params.fromAddress),
      fromName: params.fromName ?? null,
      inReplyTo: params.inReplyTo ?? null,
      messageId: params.messageId ?? null,
      provider: params.provider,
      providerMessageId: params.providerMessageId,
      references: params.references ?? [],
      replyTo: params.replyTo ?? [],
      signalId: params.signalId ?? null,
      subject: params.subject ?? null,
      text: params.text,
      threadKey: params.threadKey ?? null,
      to: params.to ?? [],
    } as NewAgentMail);

    const [inserted] = await db
      .insert(agentMails)
      .values(values)
      .onConflictDoNothing({ target: [agentMails.accountId, agentMails.providerMessageId] })
      .returning();
    if (inserted) return { created: true, mail: inserted };

    const [existing] = await db
      .select()
      .from(agentMails)
      .where(
        and(
          eq(agentMails.accountId, params.accountId),
          eq(agentMails.providerMessageId, params.providerMessageId),
        ),
      )
      .limit(1);

    return { created: false, mail: existing };
  };

  /**
   * The newest inbound mail from someone other than `recipient`, delivered at or
   * after `since`, whose subject or body contains any of `candidates` once case
   * and separators are stripped from both sides — the check for links, tokens and
   * credentials an unattended reply must not relay. Sent mail never counts: the
   * agent's own words are not another sender's secret.
   *
   * `candidates` must already be normalised the same way (lowercased, non
   * alphanumerics removed). A purged mail has no subject or body left, so it
   * no longer counts.
   */
  findTextFromOtherSender = async (params: {
    agentId: string;
    candidates: string[];
    recipient: string;
    since: Date;
  }): Promise<{ from: string } | undefined> => {
    if (params.candidates.length === 0) return undefined;

    const [row] = await this.db
      .select({ from: agentMails.fromAddress })
      .from(agentMails)
      .where(
        and(
          this.ownership(),
          eq(agentMails.agentId, params.agentId),
          eq(agentMails.direction, 'inbound'),
          gte(agentMails.deliveredAt, params.since),
          sql`${agentMails.fromAddress} <> ${normalizeMailAddress(params.recipient)}`,
          or(
            ...params.candidates.map(
              (candidate) =>
                sql`strpos(lower(regexp_replace(coalesce(${agentMails.subject}, '') || ' ' || ${agentMails.text}, '[^0-9A-Za-z]', '', 'g')), ${candidate}) > 0`,
            ),
          ),
        ),
      )
      .orderBy(sql`${agentMails.deliveredAt} desc`)
      .limit(1);

    return row;
  };

  /**
   * Every distinct code extracted from inbound mail sent by someone other than
   * `recipient` at or after `since`, with its sender. The whole window is read in
   * one query (codes only), so a flood of later mail cannot hide one. A purged
   * mail's codes are wiped with it.
   */
  listCodesFromOtherSenders = async (params: {
    agentId: string;
    recipient: string;
    since: Date;
  }): Promise<{ code: string; from: string }[]> => {
    const code = sql<string>`jsonb_array_elements_text(${agentMails.codes})`;

    return this.db
      .selectDistinct({ code, from: agentMails.fromAddress })
      .from(agentMails)
      .where(
        and(
          this.ownership(),
          eq(agentMails.agentId, params.agentId),
          eq(agentMails.direction, 'inbound'),
          gte(agentMails.deliveredAt, params.since),
          sql`${agentMails.fromAddress} <> ${normalizeMailAddress(params.recipient)}`,
        ),
      );
  };

  /**
   * The newest inbound mail from someone other than `recipient`, delivered at or
   * after `since`, carrying a secret that `compactText` repeats.
   *
   * The inverse of {@link findTextFromOtherSender}: the secrets are taken from
   * the *source* mail (subject and body) — links, long tokens, and runs of six
   * or more letters and digits that mix both — and each is looked for inside the
   * outgoing text with everything but letters and digits stripped. However the
   * reply regroups, spaces out or wraps a secret (`AB  12  CD`, `token=AB12CD`,
   * a link carrying it as a parameter), the stripped text still contains it.
   *
   * `compactText` must be the outgoing text lowercased with non alphanumerics
   * removed. A purged mail has no subject or body left, so it no longer counts.
   */
  findSecretRepeatedFromOtherSender = async (params: {
    agentId: string;
    compactText: string;
    recipient: string;
    since: Date;
  }): Promise<{ from: string } | undefined> => {
    if (params.compactText.length === 0) return undefined;

    // Each kind of secret is matched on its own, so a long fragment does not
    // hide the shorter token inside it.
    const secrets = secretSource(agentMails.subject, agentMails.text);

    const [row] = await this.db
      .select({ from: agentMails.fromAddress })
      .from(agentMails)
      .where(
        and(
          this.ownership(),
          eq(agentMails.agentId, params.agentId),
          eq(agentMails.direction, 'inbound'),
          gte(agentMails.deliveredAt, params.since),
          sql`${agentMails.fromAddress} <> ${normalizeMailAddress(params.recipient)}`,
          sql`exists (
            select 1 from (${secrets}) as s
            where length(s.secret) >= 6 and strpos(${params.compactText}, s.secret) > 0
          )`,
        ),
      )
      .orderBy(sql`${agentMails.deliveredAt} desc`)
      .limit(1);

    return row;
  };

  /**
   * Whether the agent sent mail in this thread to `address` (as a `To` or `Cc`
   * recipient). Unscoped: the inbound edge asks before any user is known.
   */
  static hasSentInThreadTo = async (
    db: LobeChatDatabase,
    params: { accountId: string; address: string; threadKey: string },
  ): Promise<boolean> => {
    const [row] = await db
      .select({ id: agentMails.id })
      .from(agentMails)
      .where(
        and(
          eq(agentMails.accountId, params.accountId),
          eq(agentMails.threadKey, params.threadKey),
          eq(agentMails.direction, 'outbound'),
          sql`exists (
            select 1 from jsonb_array_elements(${agentMails.to} || ${agentMails.cc}) as recipient
            where lower(recipient->>'address') = ${normalizeMailAddress(params.address)}
          )`,
        ),
      )
      .limit(1);

    return !!row;
  };

  /** One account's thread, oldest first — both what arrived and what the agent sent. */
  listThread = async (params: { accountId: string; threadKey: string }): Promise<AgentMailItem[]> =>
    this.db
      .select()
      .from(agentMails)
      .where(
        and(
          this.ownership(),
          eq(agentMails.accountId, params.accountId),
          eq(agentMails.threadKey, params.threadKey),
        ),
      )
      .orderBy(agentMails.deliveredAt);

  // --------------- Mailbox (what a person files and reads) ---------------

  /**
   * One folder (or a search's matches) as conversations, newest first: each row
   * is the newest mail of its conversation inside the view, with how many mails
   * the view holds and whether any is unread or starred. Trash sorts by when it
   * was thrown away, so what was just binned is on top.
   *
   * A page costs its own size, not the folder's: the newest mails of their
   * conversations are walked off the folder index from the cursor down (each
   * checked against its thread through `agent_mails_account_thread_idx`), and
   * the counts are then taken for those conversations only.
   */
  listConversations = async (params: ListAgentMailConversationsParams) => {
    if (params.mailIds?.length === 0) return [];

    const trash = params.folder === 'trash';
    const sortOf = (t: AgentMailTable) => (trash ? t.trashedAt : t.deliveredAt);
    const sortColumn = sortOf(agentMails);

    const heads = await this.db
      .select({
        accountId: agentMails.accountId,
        agentId: agentMails.agentId,
        direction: agentMails.direction,
        fromAddress: agentMails.fromAddress,
        fromName: agentMails.fromName,
        hasAttachments: sql<boolean>`jsonb_array_length(${agentMails.attachments}) > 0`,
        id: agentMails.id,
        isStarred: sql<boolean>`${agentMails.starredAt} is not null`,
        isUnread,
        preview: sql<string>`left(${agentMails.text}, 200)`,
        sortAt: sql<Date>`${sortColumn}`.mapWith(agentMails.deliveredAt),
        subject: agentMails.subject,
        threadKey: agentMails.threadKey,
        to: agentMails.to,
        trashedAt: agentMails.trashedAt,
      })
      .from(agentMails)
      .leftJoin(agentInboxMessages, inboxItemOfMail)
      .where(
        and(
          this.ownership(),
          eq(agentMails.agentId, params.agentId),
          params.accountId ? eq(agentMails.accountId, params.accountId) : undefined,
          viewFilter(params),
          // The newest of its conversation in this view: nothing in the same
          // thread sorts after it. Unthreaded mail is a conversation of one.
          or(
            isNull(agentMails.threadKey),
            notExists(
              this.db
                .select({ id: newerMails.id })
                .from(newerMails)
                .where(
                  and(
                    eq(newerMails.accountId, agentMails.accountId),
                    eq(newerMails.threadKey, agentMails.threadKey),
                    viewFilter(params, newerMails),
                    sql`(${sortOf(newerMails)}, ${newerMails.id}) > (${sortColumn}, ${agentMails.id})`,
                  ),
                ),
            ),
          ),
          params.before
            ? sql`(${sortColumn}, ${agentMails.id}) < (${params.before.sortAt.toISOString()}::timestamptz, ${params.before.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(sortColumn), desc(agentMails.id))
      .limit(params.limit ?? 30);

    const threaded = heads.filter((head) => head.threadKey);
    if (threaded.length === 0) return heads.map((head) => ({ ...head, mailCount: 1 }));

    // Same view, these conversations only.
    const totals = await this.db
      .select({
        accountId: agentMails.accountId,
        anyStarred: sql<boolean>`bool_or(${agentMails.starredAt} is not null)`,
        anyUnread: sql<boolean>`bool_or(${isUnread})`,
        mailCount: sql<number>`count(*)::int`,
        threadKey: agentMails.threadKey,
      })
      .from(agentMails)
      .leftJoin(agentInboxMessages, inboxItemOfMail)
      .where(
        and(
          this.ownership(),
          or(
            ...threaded.map((head) =>
              and(
                eq(agentMails.accountId, head.accountId),
                eq(agentMails.threadKey, head.threadKey!),
              ),
            ),
          ),
          viewFilter(params),
        ),
      )
      .groupBy(agentMails.accountId, agentMails.threadKey);

    const totalOf = new Map(totals.map((row) => [`${row.accountId}\n${row.threadKey}`, row]));

    return heads.map((head) => {
      const total = head.threadKey
        ? totalOf.get(`${head.accountId}\n${head.threadKey}`)
        : undefined;
      if (!total) return { ...head, mailCount: 1 };

      return {
        ...head,
        isStarred: total.anyStarred,
        isUnread: total.anyUnread,
        mailCount: total.mailCount,
      };
    });
  };

  /**
   * Search everything not trashed, as conversations built from the matching
   * mails. The deployment's search provider picks the best
   * {@link AGENT_MAIL_SEARCH_POOL} matches; scope, visibility and paging are
   * then applied here, so the provider never decides what a caller may see.
   * A provider failure is thrown, never answered with a cruder search.
   */
  searchConversations = async (
    params: SearchAgentMailConversationsParams,
  ): Promise<SearchAgentMailConversationsResult> => {
    const text = params.query.trim();
    if (!text) return { items: [], truncated: false };

    const { ids, truncated } = await this.findSearchMatches(params, text);
    if (ids.length === 0) return { items: [], truncated };

    const items = await this.listConversations({
      accountId: params.accountId,
      agentId: params.agentId,
      before: params.before,
      limit: params.limit,
      mailIds: ids,
    });

    return { items, truncated };
  };

  private findSearchMatches = async (
    params: SearchAgentMailConversationsParams,
    text: string,
  ): Promise<{ ids: string[]; truncated: boolean }> => {
    const source = this.ftsSearchCandidateSource;
    if (!source) throw new Error('Agent mail search needs the full-text search repository');

    if (source.ftsSearchCandidateEnabled) {
      const result = await source.ftsSearchCandidates({
        entity: 'agentMails',
        filters: { mailScope: { accountId: params.accountId, agentId: params.agentId } },
        pagination: { limit: AGENT_MAIL_SEARCH_POOL },
        query: { text },
      });

      // Providers over-fetch past the pool; keep the same best matches every
      // provider would, and say so when anything ranked below them was left.
      return {
        ids: result.candidates.slice(0, AGENT_MAIL_SEARCH_POOL).map((candidate) => candidate.id),
        truncated: result.total > AGENT_MAIL_SEARCH_POOL,
      };
    }

    // pg_search answers candidates inline, from `agent_mails_bm25_idx`. Words
    // the BM25 parser drops (`-`, `and`, `or`, `not`) leave nothing to match.
    const query = bm25MatchTextOf(text);
    if (!query) return { ids: [], truncated: false };
    const rows = await this.db
      .select({ id: agentMails.id })
      .from(agentMails)
      .where(
        and(
          this.ownership(),
          eq(agentMails.agentId, params.agentId),
          params.accountId ? eq(agentMails.accountId, params.accountId) : undefined,
          isNull(agentMails.trashedAt),
          isNull(agentMails.purgedAt),
          sql`${agentMails.id} @@@ paradedb.boolean(should => ARRAY[${sql.join(
            BM25_MAIL_FIELDS.map(
              (field) => sql`paradedb.match(${field}, ${query}, conjunction_mode => true)`,
            ),
            sql`, `,
          )}])`,
        ),
      )
      .orderBy(sql`paradedb.score(${agentMails.id}) desc`)
      .limit(AGENT_MAIL_SEARCH_POOL + 1);

    return {
      ids: rows.slice(0, AGENT_MAIL_SEARCH_POOL).map((row) => row.id),
      truncated: rows.length > AGENT_MAIL_SEARCH_POOL,
    };
  };

  /** How much the tabs announce: unread mail in the inbox. */
  countUnread = async (params: { accountId?: string; agentId: string }): Promise<number> => {
    const [row] = await this.db
      .select({ value: count() })
      .from(agentMails)
      .leftJoin(agentInboxMessages, inboxItemOfMail)
      .where(
        and(
          this.ownership(),
          eq(agentMails.agentId, params.agentId),
          params.accountId ? eq(agentMails.accountId, params.accountId) : undefined,
          isNull(agentMails.purgedAt),
          folderFilter('inbox'),
          isUnread,
        ),
      );

    return row?.value ?? 0;
  };

  /**
   * Unread inbox mail of each of these addresses in one query, for an address
   * list. Addresses out of the caller's scope, or with nothing unread, are left
   * out.
   */
  countUnreadByAccount = async (accountIds: string[]): Promise<AgentMailAccountCounts[]> => {
    if (accountIds.length === 0) return [];

    return this.db
      .select({ accountId: agentMails.accountId, unread: count() })
      .from(agentMails)
      .leftJoin(agentInboxMessages, inboxItemOfMail)
      .where(
        and(
          this.ownership(),
          inArray(agentMails.accountId, accountIds),
          isNull(agentMails.purgedAt),
          folderFilter('inbox'),
          isUnread,
        ),
      )
      .groupBy(agentMails.accountId);
  };

  /** One mail, unless it is purged or out of the caller's scope. */
  findById = async (id: string) => {
    const [row] = await this.db
      .select({
        ...getTableColumns(agentMails),
        inboxMessageId: agentInboxMessages.id,
        isUnread,
      })
      .from(agentMails)
      .leftJoin(agentInboxMessages, inboxItemOfMail)
      .where(and(eq(agentMails.id, id), isNull(agentMails.purgedAt), this.ownership()))
      .limit(1);

    return row;
  };

  /**
   * The mail an id opens: the mail's own id, or its inbox item's. Two point
   * lookups on primary keys, so opening costs the same in any mailbox size.
   */
  private findSeed = async (id: string) => {
    const seedOf = async (mailId: SQLWrapper | string) => {
      const [row] = await this.db
        .select({
          accountId: agentMails.accountId,
          id: agentMails.id,
          threadKey: agentMails.threadKey,
        })
        .from(agentMails)
        .where(and(eq(agentMails.id, mailId), isNull(agentMails.purgedAt), this.ownership()))
        .limit(1);
      return row;
    };

    return (
      (await seedOf(id)) ??
      (await seedOf(
        this.db
          .select({ id: agentInboxMessages.sourceId })
          .from(agentInboxMessages)
          .where(and(eq(agentInboxMessages.id, id), eq(agentInboxMessages.sourceType, 'mail'))),
      ))
    );
  };

  /**
   * The conversation a mail belongs to, oldest first. `id` is the mail's or its
   * inbox item's, so the inbox can open a conversation straight from its row.
   * Trash and the other views are kept apart: opening a trashed mail shows only
   * what was trashed.
   */
  listConversation = async (params: { folder?: AgentMailFolder; id: string }) => {
    const seed = await this.findSeed(params.id);
    if (!seed) return [];

    return this.db
      .select({
        ...getTableColumns(agentMails),
        inboxMessageId: agentInboxMessages.id,
        isUnread,
      })
      .from(agentMails)
      .leftJoin(agentInboxMessages, inboxItemOfMail)
      .where(
        and(
          this.ownership(),
          isNull(agentMails.purgedAt),
          params.folder === 'trash'
            ? isNotNull(agentMails.trashedAt)
            : isNull(agentMails.trashedAt),
          seed.threadKey
            ? and(
                eq(agentMails.accountId, seed.accountId),
                eq(agentMails.threadKey, seed.threadKey),
              )
            : eq(agentMails.id, seed.id),
        ),
      )
      .orderBy(asc(agentMails.deliveredAt), asc(agentMails.id));
  };

  /** The newest mail received in a thread: what answering a sent mail answers. */
  findLatestInboundInThread = async (params: { accountId: string; threadKey: string }) => {
    const [row] = await this.db
      .select()
      .from(agentMails)
      .where(
        and(
          this.ownership(),
          eq(agentMails.accountId, params.accountId),
          eq(agentMails.threadKey, params.threadKey),
          eq(agentMails.direction, 'inbound'),
          isNull(agentMails.purgedAt),
        ),
      )
      .orderBy(desc(agentMails.deliveredAt))
      .limit(1);

    return row;
  };

  /**
   * Every mail of the given mails' conversations that sits in `folder`, so an
   * action on a list row covers the conversation that row stands for.
   */
  expandToConversations = async (ids: string[], folder: AgentMailFolder): Promise<string[]> => {
    if (ids.length === 0) return [];

    const seeds = await this.db
      .select({
        accountId: agentMails.accountId,
        id: agentMails.id,
        threadKey: agentMails.threadKey,
      })
      .from(agentMails)
      .where(and(inArray(agentMails.id, ids), this.ownership()));
    if (seeds.length === 0) return [];

    const rows = await this.db
      .select({ id: agentMails.id })
      .from(agentMails)
      .where(
        and(
          this.ownership(),
          isNull(agentMails.purgedAt),
          folderFilter(folder),
          or(
            ...seeds.map((seed) =>
              seed.threadKey
                ? and(
                    eq(agentMails.accountId, seed.accountId),
                    eq(agentMails.threadKey, seed.threadKey),
                  )
                : eq(agentMails.id, seed.id),
            ),
          ),
        ),
      );

    return rows.map((row) => row.id);
  };

  /** The agents owning these mails, for the permission check before a write. */
  listAgentIds = async (ids: string[]): Promise<string[]> => {
    if (ids.length === 0) return [];

    const rows = await this.db
      .selectDistinct({ agentId: agentMails.agentId })
      .from(agentMails)
      .where(and(inArray(agentMails.id, ids), this.ownership()));

    return rows.map((row) => row.agentId);
  };

  private updateLive = async (
    ids: string[],
    values: Partial<NewAgentMail>,
    extra?: ReturnType<typeof and>,
  ): Promise<string[]> => {
    if (ids.length === 0) return [];

    const rows = await this.db
      .update(agentMails)
      .set({ ...values, updatedAt: new Date() })
      .where(and(inArray(agentMails.id, ids), isNull(agentMails.purgedAt), extra, this.ownership()))
      .returning({ id: agentMails.id });

    return rows.map((row) => row.id);
  };

  /**
   * Read as a person means it: stamps the inbox item the same way opening it
   * always has, and clears any request to see it unread.
   */
  markRead = async (ids: string[]): Promise<number> => {
    const updated = await this.updateLive(ids, { markedUnreadAt: null });
    if (updated.length > 0) {
      await this.db
        .update(agentInboxMessages)
        .set({ readAt: sql`coalesce(${agentInboxMessages.readAt}, now())`, updatedAt: new Date() })
        .where(
          and(
            eq(agentInboxMessages.sourceType, 'mail'),
            inArray(agentInboxMessages.sourceId, updated),
          ),
        );
    }

    return updated.length;
  };

  /** Never touches `read_at`: an already-handled mail must not wake the agent again. */
  markUnread = async (ids: string[]): Promise<number> =>
    (await this.updateLive(ids, { markedUnreadAt: new Date() })).length;

  setStarred = async (ids: string[], starred: boolean): Promise<number> =>
    (await this.updateLive(ids, { starredAt: starred ? new Date() : null })).length;

  /**
   * Returns the ids it moved — not the ones asked for. A mail someone else
   * already trashed is left out, so an undo restores only what this call moved.
   */
  moveToTrash = async (ids: string[]): Promise<string[]> =>
    this.updateLive(ids, { trashedAt: new Date() }, isNull(agentMails.trashedAt));

  /**
   * Not while a purge holds the mail: its provider copy may already be gone, and
   * a restored mail without one could no longer be replied to or forwarded.
   */
  restore = async (ids: string[]): Promise<number> =>
    (
      await this.updateLive(
        ids,
        { trashedAt: null },
        and(isNotNull(agentMails.trashedAt), purgeClaimFree()),
      )
    ).length;

  /**
   * Take the right to purge these trashed mails, before anything irreversible
   * happens on the provider. Returns the ids claimed; a mail restored or claimed
   * by another purge in the meantime is left out.
   */
  claimForPurge = async (ids: string[]): Promise<string[]> => {
    if (ids.length === 0) return [];

    const rows = await this.db
      .update(agentMails)
      .set({ purgeClaimedAt: sql`now()` })
      .where(
        and(
          inArray(agentMails.id, ids),
          isNotNull(agentMails.trashedAt),
          isNull(agentMails.purgedAt),
          purgeClaimFree(),
          this.ownership(),
        ),
      )
      .returning({ id: agentMails.id });

    return rows.map((row) => row.id);
  };

  /** Hand back purge claims whose provider delete failed, so the mail can be restored. */
  releasePurge = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return;

    await this.db
      .update(agentMails)
      .set({ purgeClaimedAt: null })
      .where(and(inArray(agentMails.id, ids), this.ownership()));
  };

  /** Of `ids`, those that may be purged: only what is already in the trash. */
  listPurgeTargets = async (ids: string[]): Promise<AgentMailPurgeTarget[]> => {
    if (ids.length === 0) return [];

    return this.db
      .select({
        accountId: agentMails.accountId,
        agentId: agentMails.agentId,
        id: agentMails.id,
        providerMessageId: agentMails.providerMessageId,
      })
      .from(agentMails)
      .where(
        and(
          inArray(agentMails.id, ids),
          isNotNull(agentMails.trashedAt),
          isNull(agentMails.purgedAt),
          this.ownership(),
        ),
      );
  };

  /** The next batch of an address's trash, for emptying it. */
  listTrashTargets = async (params: {
    accountId: string;
    limit: number;
  }): Promise<AgentMailPurgeTarget[]> =>
    this.db
      .select({
        accountId: agentMails.accountId,
        agentId: agentMails.agentId,
        id: agentMails.id,
        providerMessageId: agentMails.providerMessageId,
      })
      .from(agentMails)
      .where(
        and(
          eq(agentMails.accountId, params.accountId),
          isNotNull(agentMails.trashedAt),
          isNull(agentMails.purgedAt),
          // Held by another purge already: emptying would only contend for it.
          purgeClaimFree(),
          this.ownership(),
        ),
      )
      .limit(params.limit);

  /**
   * Wipe what the mail said and who it was to, keep the row. Deleting it would
   * reset wake budgets and let a provider retry deliver the mail afresh, so
   * `from_address`, the provider and RFC ids and the thread key stay.
   *
   * Nothing else is kept: subject, body, names, recipients, attachments and
   * extracted codes all go. Deleting means deleting, so from then on the relay
   * checks ({@link findTextFromOtherSender}, {@link listCodesFromOtherSenders},
   * {@link findSecretRepeatedFromOtherSender}) no longer see this mail, and a
   * purged sent mail no longer counts as the agent having written to its
   * recipients in that thread ({@link hasSentInThreadTo}).
   *
   * The inbox item's title and preview go too. Returns the purged mails with
   * the signal each arrived as, whose raw payload is a second copy of the
   * content `AgentMailPurgeRepository` blanks in the same transaction.
   */
  purge = async (ids: string[]): Promise<AgentMailPurged[]> => {
    if (ids.length === 0) return [];

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(agentMails)
        .set({
          attachments: [],
          bcc: [],
          cc: [],
          codes: [],
          fromName: null,
          purgedAt: new Date(),
          replyTo: [],
          subject: null,
          text: '',
          to: [],
          updatedAt: new Date(),
        })
        .where(
          and(
            inArray(agentMails.id, ids),
            isNotNull(agentMails.trashedAt),
            isNull(agentMails.purgedAt),
            this.ownership(),
          ),
        )
        .returning({ id: agentMails.id, signalId: agentMails.signalId });
      if (rows.length === 0) return [];

      await tx
        .update(agentInboxMessages)
        .set({ preview: null, title: null, updatedAt: new Date() })
        .where(
          and(
            eq(agentInboxMessages.sourceType, 'mail'),
            inArray(
              agentInboxMessages.sourceId,
              rows.map((row) => row.id),
            ),
          ),
        );

      return rows;
    });
  };
}
