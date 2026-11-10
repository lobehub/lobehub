import { findLoopingRecipient } from '@lobechat/agent-address-mail';
import type {
  AgentAccountOutboundMessage,
  AgentAccountSendResult,
  AgentMailAddress,
  AgentMailComposeMode,
} from '@lobechat/types';

import type { AgentAccountView } from '@/database/models/agentAccount';
import type { AgentMailPurgeTarget } from '@/database/models/agentMail';
import { AgentMailModel } from '@/database/models/agentMail';
import { AgentMailDraftModel } from '@/database/models/agentMailDraft';
import type { AgentMailItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { AgentAccountError, isAgentAccountError } from './errors';
import { AgentInboxService } from './inbox';
import type { AgentAccountService } from './index';

/** How many provider deletes run at once while purging. */
const PURGE_CONCURRENCY = 10;

export interface SendAgentMailInput {
  accountId: string;
  bcc?: AgentMailAddress[];
  cc?: AgentMailAddress[];
  /** With `forward`: which of the original's attachments to carry; omitted means all. */
  forwardAttachmentIndexes?: number[];
  mode: AgentMailComposeMode;
  /** The mail being answered or forwarded; required unless `mode` is `compose`. */
  sourceMailId?: string | null;
  subject?: string | null;
  text: string;
  to?: AgentMailAddress[];
}

export interface PurgeAgentMailResult {
  count: number;
  /** Mails whose provider copy could not be deleted; left in the trash to retry. */
  failed: number;
}

interface SendPlan {
  outbound: AgentAccountOutboundMessage;
  record: {
    bcc: AgentMailAddress[];
    cc: AgentMailAddress[];
    inReplyTo?: string | null;
    references?: string[];
    subject?: string | null;
    text: string;
    threadKey?: string | null;
    to: AgentMailAddress[];
  };
  /** A forward starts a new conversation, keyed by the message it became. */
  startsConversation: boolean;
}

const addressesOf = (list: AgentMailAddress[] | undefined) =>
  (list ?? []).map((item) => item.address);

/** The provider takes one primary `to`; the rest go alongside it. */
const splitTo = (list: AgentMailAddress[] | undefined) => {
  const [to = '', ...additionalTo] = addressesOf(list);
  return { additionalTo, to };
};

const sameAddress = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** `References` a mail answering `source` carries: its ancestors, then itself. */
const referencesAfter = (source: AgentMailItem): string[] =>
  source.messageId ? [...source.references, source.messageId] : source.references;

/**
 * Turn a provider failure into what a person can act on. Keyed on the HTTP
 * status (and the service's code when one status means several things), so an
 * unrecognised failure still reads as "nothing went out" rather than a 500.
 */
const toSendError = (error: unknown, fromAddress: string): AgentAccountError => {
  if (isAgentAccountError(error)) return error;

  const { code, status } = error as { code?: string; status?: number };
  const quota = code === 'end_user_send_limit_reached' || code === 'send_limit_reached';

  if (status === 402) {
    return new AgentAccountError('send_disabled', receiveOnlyMessage());
  }
  if (status === 429) {
    return quota
      ? new AgentAccountError(
          'send_limit_daily',
          "Today's sending quota is used up. Try again tomorrow.",
        )
      : new AgentAccountError(
          'send_limit_hourly',
          'This address is sending too often. Try again later.',
        );
  }
  if (status === 403) {
    return new AgentAccountError(
      'send_suspended',
      'This mailbox has been suspended from sending. Contact support.',
    );
  }
  if (status === 422) {
    const detail = error instanceof Error ? error.message.split(' — ').at(-1) : '';
    return new AgentAccountError(
      'send_rejected',
      `The mail was rejected. Check the recipients: ${detail}`,
    );
  }
  if (status === 404) {
    return new AgentAccountError(
      'reply_target_gone',
      'The original mail no longer exists, so it cannot be answered. Write a new mail instead.',
    );
  }

  console.error('[agentMailbox] send from %s failed:', fromAddress, error);
  return new AgentAccountError('send_failed', 'Sending failed. The mail did not go out.');
};

const receiveOnlyMessage = () => 'This address can only receive mail. Upgrade to send.';

/**
 * A person's mailbox over an agent's address: filing, drafts and sending.
 *
 * Every send goes through {@link AgentAccountService.send}, so a person is held
 * to the same lifecycle, permission, capability and provider-quota checks as
 * the agent. The relay gates in the tool runtime are not applied: they guard
 * against a prompt-injected model, and here a person is writing.
 */
export class AgentMailboxService {
  readonly drafts: AgentMailDraftModel;
  readonly mail: AgentMailModel;

  private readonly accounts: AgentAccountService;
  private readonly inbox: AgentInboxService;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    options: { accounts: AgentAccountService; workspaceId?: string },
  ) {
    this.accounts = options.accounts;
    this.drafts = new AgentMailDraftModel(db, userId, options.workspaceId);
    this.mail = new AgentMailModel(db, userId, options.workspaceId);
    this.inbox = new AgentInboxService(db, userId, options.workspaceId);
  }

  /** Changing what a mailbox holds is a *use* of its agent, the same bar as sending. */
  assertCanUseAll = async (agentIds: string[]): Promise<void> => {
    for (const agentId of new Set(agentIds)) await this.accounts.assertCanUseAgent(agentId);
  };

  requireAccount = async (accountId: string): Promise<AgentAccountView> => {
    const account = await this.accounts.get(accountId);
    if (!account) throw new AgentAccountError('account_not_found', 'Agent account not found');
    return account;
  };

  /** Refusals a person can read, before anything reaches the provider. */
  private requireSendable = async (accountId: string): Promise<AgentAccountView> => {
    const account = await this.requireAccount(accountId);
    if (account.status !== 'active') {
      throw new AgentAccountError(
        'account_unavailable',
        'This address is not active, so it cannot send mail.',
      );
    }
    if (!account.capabilities.send) {
      throw new AgentAccountError('send_disabled', receiveOnlyMessage());
    }
    return account;
  };

  private requireSource = async (
    account: AgentAccountView,
    sourceMailId: string | null | undefined,
  ): Promise<AgentMailItem> => {
    const source = sourceMailId ? await this.mail.findById(sourceMailId) : undefined;
    if (!source) {
      throw new AgentAccountError(
        'reply_target_gone',
        'The original mail no longer exists, so it cannot be answered. Write a new mail instead.',
      );
    }
    if (source.accountId !== account.id) {
      throw new AgentAccountError(
        'reply_target_not_owned',
        'Reply from the address that received this mail.',
      );
    }
    return source;
  };

  private planReply = async (
    account: AgentAccountView,
    input: SendAgentMailInput,
  ): Promise<SendPlan> => {
    const picked = await this.requireSource(account, input.sourceMailId);
    // A sent mail cannot be answered: the reply goes to the latest one received.
    const source =
      picked.direction === 'inbound'
        ? picked
        : picked.threadKey
          ? await this.mail.findLatestInboundInThread({
              accountId: account.id,
              threadKey: picked.threadKey,
            })
          : undefined;
    if (!source) {
      throw new AgentAccountError(
        'reply_target_gone',
        'This conversation has no received mail to answer. Write a new mail instead.',
      );
    }

    // The provider's reply route picks the recipients; this mirrors it for the
    // record: `Reply-To` or the sender, and with reply-all everyone but itself.
    const to: AgentMailAddress[] =
      source.replyTo.length > 0 ? source.replyTo : [{ address: source.fromAddress }];
    const replyAll = input.mode === 'replyAll';
    const cc = replyAll
      ? [...source.to, ...source.cc].filter(
          ({ address }) =>
            !sameAddress(address, account.identifier) &&
            !to.some((target) => sameAddress(target.address, address)),
        )
      : [];

    const subject = source.subject ?? '';

    return {
      outbound: {
        replyAll: replyAll || undefined,
        replyToProviderMessageId: source.providerMessageId,
        subject,
        text: input.text,
        threadKey: source.threadKey ?? undefined,
        to: to[0].address,
      },
      record: {
        bcc: [],
        cc,
        inReplyTo: source.messageId,
        references: referencesAfter(source),
        subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
        text: input.text,
        threadKey: source.threadKey ?? source.messageId,
        to,
      },
      startsConversation: false,
    };
  };

  private planForward = async (
    account: AgentAccountView,
    input: SendAgentMailInput,
  ): Promise<SendPlan> => {
    const source = await this.requireSource(account, input.sourceMailId);
    const subject = input.subject ?? `Fwd: ${source.subject ?? ''}`;
    const quote = [
      '---------- Forwarded message ---------',
      `From: ${source.fromName ? `${source.fromName} <${source.fromAddress}>` : source.fromAddress}`,
      `Subject: ${source.subject ?? ''}`,
      '',
      source.text,
    ].join('\n');
    const text =
      source.text && input.text.includes(source.text) ? input.text : `${input.text}\n\n${quote}`;

    return {
      outbound: {
        bcc: addressesOf(input.bcc),
        cc: addressesOf(input.cc),
        forwardAttachmentIndexes: input.forwardAttachmentIndexes,
        forwardAttachmentsOf: source.providerMessageId,
        subject,
        text,
        ...splitTo(input.to),
      },
      record: {
        bcc: input.bcc ?? [],
        cc: input.cc ?? [],
        // Kept so the forward can be traced to its origin. It is a new
        // conversation all the same: the provider's send route takes no
        // threading headers, so replies to it thread on its own Message-ID.
        inReplyTo: source.messageId,
        references: referencesAfter(source),
        subject,
        text,
        to: input.to ?? [],
      },
      startsConversation: true,
    };
  };

  private planCompose = (input: SendAgentMailInput): SendPlan => ({
    outbound: {
      bcc: addressesOf(input.bcc),
      cc: addressesOf(input.cc),
      subject: input.subject ?? '',
      text: input.text,
      ...splitTo(input.to),
    },
    record: {
      bcc: input.bcc ?? [],
      cc: input.cc ?? [],
      subject: input.subject,
      text: input.text,
      to: input.to ?? [],
    },
    startsConversation: true,
  });

  private assertRecipients = (account: AgentAccountView, plan: SendPlan) => {
    const recipients = [
      ...addressesOf(plan.record.to),
      ...addressesOf(plan.record.cc),
      ...addressesOf(plan.record.bcc),
    ];
    if (plan.record.to.length === 0) {
      throw new AgentAccountError('recipients_required', 'Add at least one recipient.');
    }

    const looping = findLoopingRecipient({ inboxAddress: account.identifier, recipients });
    if (looping) {
      throw new AgentAccountError(
        'recipient_looping',
        `Mail to ${looping} would only come back as a bounce or a loop, so it is not sent.`,
      );
    }
  };

  /** Write, reply, reply-all or forward as a person, then file it under Sent. */
  send = async (input: SendAgentMailInput) => {
    const account = await this.requireSendable(input.accountId);

    let plan: SendPlan;
    if (input.mode === 'reply' || input.mode === 'replyAll') {
      plan = await this.planReply(account, input);
    } else if (input.mode === 'forward') {
      plan = await this.planForward(account, input);
    } else {
      plan = this.planCompose(input);
    }
    this.assertRecipients(account, plan);

    let sent: AgentAccountSendResult;
    try {
      sent = await this.accounts.send(account.id, plan.outbound);
    } catch (error) {
      throw toSendError(error, account.identifier);
    }

    const { record } = plan;
    const messageId = sent.messageId ?? null;
    // The provider's own headers win; the plan is what it was asked to produce.
    const recorded = await this.inbox
      .recordSentMail({
        account,
        attachments: sent.attachments,
        bcc: record.bcc,
        cc: record.cc,
        inReplyTo: sent.inReplyTo ?? record.inReplyTo,
        messageId,
        providerMessageId: sent.providerMessageId,
        references: sent.references?.length ? sent.references : record.references,
        subject: record.subject,
        text: record.text,
        threadKey: plan.startsConversation ? messageId : record.threadKey,
        to: record.to,
      })
      // The mail is out: losing the bookkeeping must not report a failed send.
      .catch((error) => {
        console.error('[agentMailbox] sent mail %s not recorded:', sent.providerMessageId, error);
        return undefined;
      });

    return { mailId: recorded?.mail.id, providerMessageId: sent.providerMessageId };
  };

  /** Send a saved draft exactly once; the draft survives a failed send. */
  sendDraft = async (id: string) => {
    const draft = await this.drafts.claimForSend(id);
    if (!draft) {
      if (await this.drafts.findById(id)) {
        throw new AgentAccountError('draft_sending', 'This draft is already being sent.');
      }
      throw new AgentAccountError('draft_not_found', 'This draft no longer exists.');
    }

    let result: Awaited<ReturnType<AgentMailboxService['send']>>;
    try {
      result = await this.send({
        accountId: draft.accountId,
        bcc: draft.bcc,
        cc: draft.cc,
        mode: draft.mode,
        sourceMailId: draft.sourceMailId,
        subject: draft.subject,
        text: draft.text,
        to: draft.to,
      });
    } catch (error) {
      await this.drafts.releaseSend(id);
      throw error;
    }

    await this.drafts.delete([id]).catch((error) => {
      console.error('[agentMailbox] sent draft %s not removed:', id, error);
    });

    return result;
  };

  /**
   * Delete each mail's provider copy, then wipe the mails whose copy is gone. A
   * failure leaves that mail in the trash, intact, for the person to retry. The
   * caller has already proved it may edit the owning agents.
   */
  purge = async (targets: AgentMailPurgeTarget[]): Promise<PurgeAgentMailResult> => {
    // Claimed first, so a restore cannot slip in between deleting the provider
    // copy and wiping the row. Mails another request restored or claimed are
    // skipped, not counted as failures.
    const claimed = new Set(await this.mail.claimForPurge(targets.map((target) => target.id)));
    const owned = targets.filter((target) => claimed.has(target.id));
    const removed: string[] = [];
    const failedIds: string[] = [];
    let failed = 0;

    for (let start = 0; start < owned.length; start += PURGE_CONCURRENCY) {
      const batch = owned.slice(start, start + PURGE_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((target) =>
          this.accounts.deleteProviderMessage(target.accountId, target.providerMessageId),
        ),
      );

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          removed.push(batch[index].id);
        } else {
          failed += 1;
          failedIds.push(batch[index].id);
          console.error('[agentMailbox] provider delete failed:', result.reason);
        }
      });
    }

    await this.mail.releasePurge(failedIds);

    return { count: await this.mail.purge(removed), failed };
  };
}
