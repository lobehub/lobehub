import type {
  AgentMailAddress,
  AgentMailAttachment,
  AgentMailDirection,
  AgentMailFolder,
} from '@lobechat/types';
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
  or,
  sql,
} from 'drizzle-orm';

import type { AgentMailItem, NewAgentMail } from '../schemas';
import { agentInboxMessages, agentMails } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { agentUsableBy } from '../utils/agent-access';
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
  /** Omitted with a `query`: everything that is not trashed. */
  folder?: AgentMailFolder;
  limit?: number;
  /** Substring of the subject, sender, recipients or body. */
  query?: string;
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

/** A mail's conversation: its thread within the address, or the mail alone. */
const conversationKey = sql`${agentMails.accountId}, coalesce(${agentMails.threadKey}, ${agentMails.id}::text)`;

/**
 * Must stay identical to `agent_mails_search_trgm_idx`, or the index stops
 * matching and every search scans.
 */
const searchableText = sql`lower(coalesce(${agentMails.subject}, '') || ' ' || ${agentMails.fromAddress} || ' ' || coalesce(${agentMails.fromName}, '') || ' ' || ${agentMails.to}::text || ' ' || ${agentMails.cc}::text || ' ' || ${agentMails.text})`;

const escapeLike = (value: string) => value.replaceAll(/[%_\\]/g, '\\$&');

const folderFilter = (folder: AgentMailFolder | undefined) => {
  switch (folder) {
    case 'inbox': {
      return and(eq(agentMails.direction, 'inbound'), isNull(agentMails.trashedAt));
    }
    case 'sent': {
      return and(eq(agentMails.direction, 'outbound'), isNull(agentMails.trashedAt));
    }
    case 'starred': {
      return and(isNotNull(agentMails.starredAt), isNull(agentMails.trashedAt));
    }
    case 'trash': {
      return isNotNull(agentMails.trashedAt);
    }
    default: {
      return isNull(agentMails.trashedAt);
    }
  }
};

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

/** A recipient list reduced to its addresses, for what a purge must keep. */
const bareAddresses = (column: typeof agentMails.to | typeof agentMails.cc) =>
  sql`(select coalesce(jsonb_agg(jsonb_build_object('address', recipient->>'address')), '[]'::jsonb) from jsonb_array_elements(${column}) as recipient)`;

/** Lowercased and trimmed, the way `from_address` is stored and compared. */
export const normalizeMailAddress = (address: string): string => address.trim().toLowerCase();

/**
 * The secrets a mail carries: links, long tokens, and runs of six or more
 * letters and digits that mix both — lowercased, separators stripped. Read from
 * `subject` and `text` while they still exist, so a purge can keep the material
 * {@link AgentMailModel.findSecretRepeatedFromOtherSender} needs.
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
 * Everything both relay checks need, taken in one expression so a purge can
 * keep it after wiping `subject` and `text`: the mail compacted to letters and
 * digits (what `findTextFromOtherSender` matches candidates in), and the secrets
 * it carried (what `findSecretRepeatedFromOtherSender` looks for meanwhile).
 */
const relayGuardOf = (subject: typeof agentMails.subject, text: typeof agentMails.text) =>
  sql`jsonb_build_object(
    'text', lower(regexp_replace(coalesce(${subject}, '') || ' ' || ${text}, '[^0-9A-Za-z]', '', 'g')),
    'secrets', coalesce((select jsonb_agg(distinct s.secret) from (${secretSource(subject, text)}) as s), '[]'::jsonb)
  )`;

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

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
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
   * alphanumerics removed).
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
                // A purged mail has no subject or body left; what it said is in
                // `relay_guard`, so deleting it cannot quietly lift this check.
                sql`(strpos(lower(regexp_replace(coalesce(${agentMails.subject}, '') || ' ' || ${agentMails.text}, '[^0-9A-Za-z]', '', 'g')), ${candidate}) > 0 or strpos(coalesce(${agentMails.relayGuard}->>'text', ''), ${candidate}) > 0)`,
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
   * one query (codes only), so a flood of later mail cannot hide one.
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
   * removed.
   */
  findSecretRepeatedFromOtherSender = async (params: {
    agentId: string;
    compactText: string;
    recipient: string;
    since: Date;
  }): Promise<{ from: string } | undefined> => {
    if (params.compactText.length === 0) return undefined;

    // Each kind of secret is matched on its own, so a long fragment does not
    // hide the shorter token inside it. A purged mail has no subject or body
    // left: the secrets read out of it before the wipe live in `relay_guard`.
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
          sql`(
            exists (
              select 1 from (${secrets}) as s
              where length(s.secret) >= 6 and strpos(${params.compactText}, s.secret) > 0
            )
            or exists (
              select 1
              from jsonb_array_elements_text(coalesce(${agentMails.relayGuard}->'secrets', '[]'::jsonb)) as g(secret)
              where length(g.secret) >= 6 and strpos(${params.compactText}, g.secret) > 0
            )
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
   * One folder (or a search) as conversations, newest first: each row is the
   * newest mail of its conversation inside the view, with how many mails the
   * view holds and whether any is unread or starred. Trash sorts by when it was
   * thrown away, so what was just binned is on top.
   */
  listConversations = async (params: ListAgentMailConversationsParams) => {
    const sortColumn = params.folder === 'trash' ? agentMails.trashedAt : agentMails.deliveredAt;
    const keyword = params.query?.trim();

    const ranked = this.db
      .select({
        anyStarred:
          sql<boolean>`bool_or(${agentMails.starredAt} is not null) over (partition by ${conversationKey})`.as(
            'any_starred',
          ),
        anyUnread: sql<boolean>`bool_or(${isUnread}) over (partition by ${conversationKey})`.as(
          'any_unread',
        ),
        mailCount: sql<number>`(count(*) over (partition by ${conversationKey}))::int`.as(
          'mail_count',
        ),
        mailId: sql<string>`${agentMails.id}`.as('mail_id'),
        position:
          sql<number>`row_number() over (partition by ${conversationKey} order by ${sortColumn} desc, ${agentMails.id} desc)`.as(
            'position',
          ),
        sortAt: sql<Date>`${sortColumn}`.mapWith(agentMails.deliveredAt).as('sort_at'),
      })
      .from(agentMails)
      .leftJoin(agentInboxMessages, inboxItemOfMail)
      .where(
        and(
          this.ownership(),
          eq(agentMails.agentId, params.agentId),
          params.accountId ? eq(agentMails.accountId, params.accountId) : undefined,
          isNull(agentMails.purgedAt),
          folderFilter(params.folder),
          keyword
            ? sql`${searchableText} like ${`%${escapeLike(keyword.toLowerCase())}%`}`
            : undefined,
        ),
      )
      .as('ranked');

    return this.db
      .select({
        accountId: agentMails.accountId,
        agentId: agentMails.agentId,
        direction: agentMails.direction,
        fromAddress: agentMails.fromAddress,
        fromName: agentMails.fromName,
        hasAttachments: sql<boolean>`jsonb_array_length(${agentMails.attachments}) > 0`,
        id: agentMails.id,
        isStarred: ranked.anyStarred,
        isUnread: ranked.anyUnread,
        mailCount: ranked.mailCount,
        preview: sql<string>`left(${agentMails.text}, 200)`,
        sortAt: ranked.sortAt,
        subject: agentMails.subject,
        threadKey: agentMails.threadKey,
        to: agentMails.to,
        trashedAt: agentMails.trashedAt,
      })
      .from(ranked)
      .innerJoin(agentMails, eq(agentMails.id, sql`${ranked.mailId}`))
      .where(
        and(
          eq(ranked.position, 1),
          params.before
            ? or(
                lt(ranked.sortAt, params.before.sortAt),
                and(
                  eq(ranked.sortAt, params.before.sortAt),
                  sql`${ranked.mailId} < ${params.before.id}::uuid`,
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(ranked.sortAt), desc(sql`${ranked.mailId}`))
      .limit(params.limit ?? 30);
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
   * The conversation a mail belongs to, oldest first. Trash and the other
   * views are kept apart: opening a trashed mail shows only what was trashed.
   */
  listConversation = async (params: { folder?: AgentMailFolder; id: string }) => {
    const seed = await this.findById(params.id);
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
   * Wipe the content, keep the row. Deleting it would reset wake budgets and let
   * a provider retry deliver the mail afresh. `from_address`, the thread keys and
   * `codes` stay because delivery idempotency and the relay checks read them.
   * `relay_guard` keeps what the relay checks need out of `subject` and `text`
   * — codes are only the digit-shaped secrets — so purging a message cannot
   * turn an unattended reply into a way to relay its link or token.
   * A sent mail also keeps its `To` / `Cc` addresses, names dropped: whether the
   * agent wrote to someone in a thread decides how that person's reply wakes it
   * ({@link hasSentInThreadTo}), and purging must not change that.
   */
  purge = async (ids: string[]): Promise<number> => {
    if (ids.length === 0) return 0;

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(agentMails)
        .set({
          attachments: [],
          bcc: [],
          cc: sql`case when ${agentMails.direction} = 'outbound' then ${bareAddresses(agentMails.cc)} else '[]'::jsonb end`,
          fromName: null,
          purgedAt: new Date(),
          // Read before `subject` and `text` are wiped in the same statement:
          // the relay checks keep refusing to relay what this mail said.
          relayGuard: relayGuardOf(agentMails.subject, agentMails.text),
          replyTo: [],
          subject: null,
          text: '',
          to: sql`case when ${agentMails.direction} = 'outbound' then ${bareAddresses(agentMails.to)} else '[]'::jsonb end`,
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
        .returning({ id: agentMails.id });
      if (rows.length === 0) return 0;

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

      return rows.length;
    });
  };
}
