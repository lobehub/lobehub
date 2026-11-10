import type {
  AgentAccountKind,
  AgentInboxMessage,
  AgentInboxMessageSummary,
  AgentMailAddress,
  AgentMailComposeMode,
  AgentMailFolder,
} from '@lobechat/types';
import type { inferRouterOutputs } from '@trpc/server';

import { getBusinessTrpcHeaders } from '@/business/client/trpc-headers';
import { lambdaClient } from '@/libs/trpc/client';
import type { LambdaRouter } from '@/server/routers/lambda';

type AgentAccountRouterOutputs = inferRouterOutputs<LambdaRouter>['agentAccount'];
type InboxRow = AgentAccountRouterOutputs['inbox']['get'];
type MailRouterOutputs = AgentAccountRouterOutputs['mail'];

/** One conversation as a mail view lists it, represented by its newest mail. */
export type AgentMailConversationRow = MailRouterOutputs['list'][number];
/** One mail of an opened conversation. */
export type AgentMailRow = MailRouterOutputs['conversation'][number];
export type AgentMailDraftRow = MailRouterOutputs['drafts']['list'][number];
/** A mail's HTML body, sanitized by the server, or why there is none to show. */
export type AgentMailHtml = MailRouterOutputs['html'];

/** What a draft holds; omitted fields keep what the draft already has. */
export interface AgentMailDraftContent {
  bcc?: AgentMailAddress[];
  cc?: AgentMailAddress[];
  subject?: string | null;
  text?: string;
  to?: AgentMailAddress[];
}

export interface CreateAgentMailDraftParams extends AgentMailDraftContent {
  accountId: string;
  mode: AgentMailComposeMode;
  /** The mail answered or forwarded; one draft per mail and mode, so a repeat resumes it. */
  sourceMailId?: string;
}

export interface SendAgentMailParams extends AgentMailDraftContent {
  accountId: string;
  /** With `forward`: which of the original's attachments to carry; omitted carries all. */
  forwardAttachmentIndexes?: number[];
  mode: AgentMailComposeMode;
  sourceMailId?: string;
  text: string;
}

/** Why an attachment download failed, as the attachment route answers it. */
export type AttachmentFailure = 'expired' | 'too_large' | 'unavailable';

export class AttachmentDownloadError extends Error {
  constructor(readonly reason: AttachmentFailure) {
    super(`Attachment download failed: ${reason}`);
  }
}

const ATTACHMENT_FAILURES: Record<number, AttachmentFailure> = { 404: 'expired', 413: 'too_large' };

export interface AgentMailScope {
  accountId?: string;
  agentId: string;
}

export interface AgentMailPageParams extends AgentMailScope {
  /** Keyset cursor: the last row of the previous page. */
  before?: { id: string; sortAt: Date };
  limit?: number;
}

/** The mails a write covers. With `conversationIn`, each id stands for its conversation in that view. */
export interface AgentMailTarget {
  conversationIn?: AgentMailFolder;
  ids: string[];
}

/**
 * One identity account as the control plane returns it. Derived from the router
 * rather than restated, so the client can never drift from the contract; the
 * credential is structurally absent, and `hasCredential` is all a read knows.
 */
export type AgentAccountView = AgentAccountRouterOutputs['list'][number];

export interface ListAgentAccountsParams {
  agentId?: string;
  kind?: AgentAccountKind;
  provider?: string;
}

export interface ProvisionAgentAccountParams {
  agentId: string;
  displayName?: string;
  /** Preferred local part for a mail address; the provider may ignore it. */
  prefix?: string;
  provider: string;
}

export interface ListAgentInboxParams {
  accountId?: string;
  agentId: string;
  /** Keyset cursor: the last row of the previous page. */
  before?: { id: string; receivedAt: Date };
  limit?: number;
  unreadOnly?: boolean;
}

/** The detail read, normalized at the boundary into the client's read model. */
const toInboxMessage = (row: InboxRow): AgentInboxMessage => ({
  accountId: row.accountId,
  agentId: row.agentId,
  // An attachment-only message would otherwise open with a blank body and no
  // trace of what was sent.
  attachments: row.attachments ?? [],
  codes: row.codes ?? [],
  createdAt: row.createdAt,
  from: row.from,
  id: row.id,
  preview: row.preview,
  readAt: row.readAt,
  receivedAt: row.receivedAt,
  sourceType: row.sourceType,
  subject: row.subject,
  text: row.text,
  threadKey: row.threadKey,
  to: row.to,
});

/**
 * Client for the agent-account control plane.
 *
 * Everything here maps 1:1 onto `agentAccount` tRPC procedures — no client-side
 * orchestration, no cached identity: the accounts and the inbox both change
 * outside this tab (a webhook delivers, another device releases), so a stale
 * local copy would be a lie rather than a convenience.
 */
class AgentAccountService {
  list = (params?: ListAgentAccountsParams): Promise<AgentAccountView[]> =>
    lambdaClient.agentAccount.list.query(params);

  provision = async (params: ProvisionAgentAccountParams): Promise<AgentAccountView> => {
    const account = await lambdaClient.agentAccount.provision.mutate(params);
    // The router answers either an account or an error; a silent `undefined`
    // would leave the tab showing success for an address it never received.
    if (!account) throw new Error('Provisioning returned no account');

    return account;
  };

  revoke = (id: string, options?: { purgeCredential?: boolean; release?: boolean }) =>
    lambdaClient.agentAccount.revoke.mutate({
      id,
      purgeCredential: options?.purgeCredential,
      release: options?.release,
    });

  // --------------- Inbox ---------------

  /** A page of summaries; the body and attachments come from {@link getInboxMessage}. */
  listInbox = (params: ListAgentInboxParams): Promise<AgentInboxMessageSummary[]> =>
    lambdaClient.agentAccount.inbox.list.query(params);

  /** Unread across the whole inbox, not just the page a list happened to load. */
  getInboxUnreadCount = async (agentId: string, accountId?: string): Promise<number> =>
    (await lambdaClient.agentAccount.inbox.unreadCount.query({ accountId, agentId })).unreadCount;

  getInboxMessage = async (id: string): Promise<AgentInboxMessage> =>
    toInboxMessage(await lambdaClient.agentAccount.inbox.get.query({ id }));

  markInboxRead = (ids: string[]) => lambdaClient.agentAccount.inbox.markRead.mutate({ ids });

  markAllInboxRead = (agentId: string, accountId?: string) =>
    lambdaClient.agentAccount.inbox.markAllRead.mutate({ accountId, agentId });

  // --------------- Mailbox ---------------

  listMail = (params: AgentMailPageParams & { folder: AgentMailFolder }) =>
    lambdaClient.agentAccount.mail.list.query(params);

  searchMail = (params: AgentMailPageParams & { query: string }) =>
    lambdaClient.agentAccount.mail.search.query(params);

  /** Unread mail and drafts of several addresses in one request. */
  getMailAccountCounts = (accountIds: string[]) =>
    lambdaClient.agentAccount.mail.accountCounts.query({ accountIds });

  getMailConversation = (params: { folder?: AgentMailFolder; id: string }) =>
    lambdaClient.agentAccount.mail.conversation.query(params);

  getMailHtml = (id: string): Promise<AgentMailHtml> =>
    lambdaClient.agentAccount.mail.html.query({ id });

  /** The bytes come through the attachment route, so the browser never talks to the provider. */
  downloadMailAttachment = async (id: string, index: number): Promise<Blob> => {
    const params = new URLSearchParams({ id, index: String(index) });
    const response = await fetch(`/webapi/agent-mail/attachment?${params}`, {
      headers: await getBusinessTrpcHeaders(),
    });
    if (!response.ok) {
      throw new AttachmentDownloadError(ATTACHMENT_FAILURES[response.status] ?? 'unavailable');
    }
    return response.blob();
  };

  markMailRead = (target: AgentMailTarget) =>
    lambdaClient.agentAccount.mail.markRead.mutate(target);

  markMailUnread = (target: AgentMailTarget) =>
    lambdaClient.agentAccount.mail.markUnread.mutate(target);

  setMailStarred = (target: AgentMailTarget, starred: boolean) =>
    lambdaClient.agentAccount.mail.setStarred.mutate({ ...target, starred });

  trashMail = (target: AgentMailTarget) => lambdaClient.agentAccount.mail.trash.mutate(target);

  restoreMail = (target: AgentMailTarget) => lambdaClient.agentAccount.mail.restore.mutate(target);

  purgeMail = (target: AgentMailTarget) => lambdaClient.agentAccount.mail.purge.mutate(target);

  emptyMailTrash = (accountId: string) =>
    lambdaClient.agentAccount.mail.emptyTrash.mutate({ accountId });

  listMailDrafts = (
    params: AgentMailScope & { before?: { id: string; updatedAt: Date }; limit?: number },
  ) => lambdaClient.agentAccount.mail.drafts.list.query(params);

  deleteMailDrafts = (ids: string[]) =>
    lambdaClient.agentAccount.mail.drafts.delete.mutate({ ids });

  getMailDraft = (id: string): Promise<AgentMailDraftRow> =>
    lambdaClient.agentAccount.mail.drafts.get.query({ id });

  createMailDraft = (params: CreateAgentMailDraftParams): Promise<AgentMailDraftRow> =>
    lambdaClient.agentAccount.mail.drafts.create.mutate(params);

  updateMailDraft = (id: string, content: AgentMailDraftContent): Promise<AgentMailDraftRow> =>
    lambdaClient.agentAccount.mail.drafts.update.mutate({ ...content, id });

  /** Sends a saved draft exactly once (the server holds a lease) and deletes it. */
  sendMailDraft = (id: string) => lambdaClient.agentAccount.mail.drafts.send.mutate({ id });

  sendMail = (params: SendAgentMailParams) => lambdaClient.agentAccount.mail.send.mutate(params);
}

export const agentAccountService = new AgentAccountService();
