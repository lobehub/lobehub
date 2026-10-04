import type {
  ListAccountsArgs,
  ReadInboxArgs,
  RequestSecureInputArgs,
  SendMessageArgs,
  WaitForMessageArgs,
} from '@lobechat/builtin-tool-agent-account';
import { AgentAccountApiName, AgentAccountIdentifier } from '@lobechat/builtin-tool-agent-account';
import { AGENT_SECRET_KINDS, AGENT_SECRET_SLOT, type AgentHumanRequestItem } from '@lobechat/types';

import { AgentAccountModel, type AgentAccountView } from '@/database/models/agentAccount';
import type { AgentInboxMessageItem } from '@/database/schemas';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { createAgentHumanRequestService } from '@/server/services/agentHumanRequest/factory';
import { AgentAccountService } from '@/server/services/agentIdentity';
import { AgentInboxService } from '@/server/services/agentIdentity/inbox';
import { createDefaultAgentAccountRegistry } from '@/server/services/agentIdentity/providers';
import {
  fenceUntrustedInbox,
  toUntrustedInboxEntry,
} from '@/server/services/agentIdentity/untrusted';

import { type ServerRuntimeRegistration } from './types';

/**
 * The `wait` budget sits under the manifest's `defaultTimeoutMs` (130s) on
 * purpose: the tool must return its own "nothing arrived" answer *before* the
 * runtime's hard tool timeout kills the call. A timeout is a normal, retryable
 * outcome, not an error — the agent can wait again.
 */
const DEFAULT_WAIT_MS = 60_000;
const MAX_WAIT_MS = 120_000;
const POLL_INTERVAL_MS = 1_000;

const DEFAULT_READ_LIMIT = 10;
const MAX_READ_LIMIT = 20;

/** How far back a reply is checked for codes relayed from another sender. */
const CODE_RELAY_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

const normalizeAddress = (value: string) => value.trim().toLowerCase();

/**
 * Which kind of account can reach `to`: an email address needs a `mail`
 * account, a phone number a `phone` one. `undefined` when it is neither, so
 * the provider gets to decide.
 */
const recipientKind = (to: string): 'mail' | 'phone' | undefined => {
  const value = to.trim();
  if (/^[^\s@]+@[^\s@]+$/.test(value)) return 'mail';
  if (/^\+?[\d\s().-]{6,}$/.test(value)) return 'phone';
  return undefined;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const asJson = (value: unknown) => JSON.stringify(value, null, 2);

/**
 * Server runtime for the agent-account tool.
 *
 * The account *state* (addresses + unread count) reaches the model as context.
 * Message content does not: it is attacker-controlled, so it is read here and
 * handed back inside an `<untrusted_inbox>` fence. Every API is scoped to the
 * run's agent — an account id that belongs to someone else is refused, so the
 * tool cannot be used as a confused deputy.
 *
 * `sendMessage` is the exfiltration edge, and the gate lives here rather than
 * in the run's approval mode, so auto-run, headless and inbound-woken runs are
 * held exactly like an interactive one. A send goes out unattended only when it
 * answers an existing thread: the thread must be in this account's inbox, `to`
 * must be its sender, and the text must not relay a code this agent received
 * from someone else. Everything else is parked as an approval card the owner
 * sends, edits or discards — the run does not wait for it; the outcome arrives
 * as a later turn.
 *
 * `requestSecureInput` parks a message with a `{{secret}}` slot as a secure
 * input card. The owner's value is sealed to the server (ASC/1 HPKE), which
 * fills the slot and sends; the value never comes back through this tool.
 */
export const agentAccountRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for the agent-account tool');
    }

    const db = context.serverDB;
    const userId = context.userId;
    const workspaceId = context.workspaceId;
    const agentId = context.agentId;

    const requireAgentId = () => {
      if (!agentId) throw new Error('Agent id is required for the agent-account tool');
      return agentId;
    };

    const accounts = () =>
      new AgentAccountModel(db, userId, undefined, workspaceId).query({
        agentId: requireAgentId(),
        // A released address is not the agent's any more: it can neither be
        // listed, sent from, nor waited on.
        liveOnly: true,
      });

    const inbox = new AgentInboxService(db, userId, workspaceId);

    const humanRequests = () => createAgentHumanRequestService(db, userId, { workspaceId });

    const origin = () => ({
      agentId: requireAgentId(),
      operationId: context.operationId,
      toolCallId: context.toolCallId,
      topicId: context.topicId,
    });

    /**
     * Resolve the account to send from: the named one, or the first
     * send-capable one that can reach `to` — an email goes out from the mail
     * address, a text from the number, never the other way round.
     */
    const resolveSender = async (
      ref: string | undefined,
      to: string,
    ): Promise<{ account: AgentAccountView } | { refusal: string }> => {
      const list = await accounts();
      const kind = recipientKind(to);

      if (ref) {
        // Accept either the account id or the address the model sees in
        // context — the model refers to accounts by address, so matching only
        // on the uuid would refuse a perfectly valid send.
        const account = findOwned(list, ref);
        if (!account) return { refusal: `No account ${ref} is owned by this agent.` };
        if (kind && account.kind !== kind) {
          return {
            refusal: `${account.identifier} is a ${account.kind} account and cannot send to ${to}.`,
          };
        }
        return { account };
      }

      const account = list.find((item) => item.capabilities.send && (!kind || item.kind === kind));
      if (!account) {
        return {
          refusal: kind
            ? `This agent has no send-capable ${kind} account to reach ${to}.`
            : 'This agent has no send-capable account yet.',
        };
      }
      return { account };
    };

    const parkedContent = (item: AgentHumanRequestItem, note: string) =>
      asJson({
        expiresAt: item.expiresAt.toISOString(),
        note,
        requestId: item.id,
        status: item.type === 'secret' ? 'awaiting_user_input' : 'awaiting_approval',
      });

    const describeError = (error: unknown) =>
      error instanceof Error ? error.message : String(error);

    /** Accept either the account id or the address the model sees in context. */
    const findOwned = (list: Awaited<ReturnType<typeof accounts>>, ref: string) =>
      list.find((account) => account.id === ref || account.identifier === ref);

    /**
     * Check an unattended thread reply. Returns why it cannot go out
     * unattended (the send is then parked for approval instead), or the
     * newest message from the recipient on that thread, which the reply
     * answers.
     */
    const checkThreadReply = async (
      accountId: string,
      args: SendMessageArgs & { threadKey: string },
    ): Promise<{ refusal: string } | { replyTo: AgentInboxMessageItem }> => {
      const recipient = normalizeAddress(args.to);
      const thread = await inbox.list({
        accountId,
        agentId: requireAgentId(),
        limit: 50,
        threadKey: args.threadKey,
      });

      // `list` is newest first, so this is the message being answered.
      const replyTo = thread.find((message) => normalizeAddress(message.from) === recipient);
      if (!replyTo) {
        return {
          refusal: `Thread ${args.threadKey} has no message from ${args.to} in this inbox, so this is not a reply.`,
        };
      }

      const recent = await inbox.list({
        agentId: requireAgentId(),
        limit: 200,
        receivedAfter: new Date(Date.now() - CODE_RELAY_LOOKBACK_MS),
      });
      const relayed = recent.find(
        (message) =>
          normalizeAddress(message.from) !== recipient &&
          (message.codes ?? []).some((code) => args.text.includes(code)),
      );
      if (relayed) {
        return {
          refusal: `This reply contains a verification code that ${relayed.from} sent you. Codes are never relayed to another sender without the user's approval.`,
        };
      }

      return { replyTo };
    };

    return {
      readInbox: async (args: ReadInboxArgs) => {
        let accountId: string | undefined;
        if (args?.accountId) {
          const target = findOwned(await accounts(), args.accountId);
          if (!target) {
            return {
              content: `No account ${args.accountId} is owned by this agent.`,
              success: false,
            };
          }
          accountId = target.id;
        }

        const limit = Math.min(Math.max(args?.limit ?? DEFAULT_READ_LIMIT, 1), MAX_READ_LIMIT);
        const rows = await inbox.list({
          accountId,
          agentId: requireAgentId(),
          limit,
          unreadOnly: args?.unreadOnly ?? true,
        });

        if (rows.length === 0) {
          return { content: 'No messages.', success: true };
        }

        // Reading is what "read" means: the unread count in context drops.
        await inbox.markRead(rows.filter((row) => !row.readAt).map((row) => row.id));

        return {
          content: fenceUntrustedInbox(rows.map((row) => toUntrustedInboxEntry(row))),
          state: { inboxMessageIds: rows.map((row) => row.id) },
          success: true,
        };
      },

      listAccounts: async (_args: ListAccountsArgs) => {
        const list = await accounts();
        return {
          content: asJson({
            accounts: list.map((account) => ({
              capabilities: account.capabilities,
              displayName: account.displayName,
              identifier: account.identifier,
              kind: account.kind,
              provider: account.provider,
              status: account.status,
            })),
          }),
          success: true,
        };
      },

      requestSecureInput: async (args: RequestSecureInputArgs) => {
        if (!args?.to || !args?.text) {
          return { content: 'requestSecureInput requires both `to` and `text`.', success: false };
        }
        if (!(AGENT_SECRET_KINDS as readonly string[]).includes(args.kind)) {
          return {
            content: `\`kind\` must be one of ${AGENT_SECRET_KINDS.join(', ')}.`,
            success: false,
          };
        }
        if (args.text.split(AGENT_SECRET_SLOT).length !== 2) {
          return {
            content: `The text must contain ${AGENT_SECRET_SLOT} exactly once, where the user's value goes.`,
            success: false,
          };
        }

        const resolved = await resolveSender(args.accountId, args.to);
        if ('refusal' in resolved) return { content: resolved.refusal, success: false };
        const { account } = resolved;

        try {
          const item = await (
            await humanRequests()
          ).requestSecret(origin(), {
            accountId: account.id,
            channel: account.kind,
            from: account.identifier,
            kind: args.kind,
            reason: args.reason,
            subject: args.subject,
            text: args.text,
            threadKey: args.threadKey,
            to: args.to,
          });

          return {
            content: parkedContent(
              item,
              'The user fills the value in a secure card; it is sent without passing through you. You will be told in a later turn whether the message went out. Do not ask for the value in chat.',
            ),
            state: { humanRequestId: item.id },
            success: true,
          };
        } catch (error) {
          return {
            content: `Could not request secure input: ${describeError(error)}`,
            success: false,
          };
        }
      },

      sendMessage: async (args: SendMessageArgs) => {
        if (!args?.to || !args?.text) {
          return { content: 'sendMessage requires both `to` and `text`.', success: false };
        }
        if (args.text.includes(AGENT_SECRET_SLOT)) {
          return {
            content: `${AGENT_SECRET_SLOT} is only filled by requestSecureInput. Use that for a message that needs a value only the user has.`,
            success: false,
          };
        }

        const resolved = await resolveSender(args.accountId, args.to);
        if ('refusal' in resolved) return { content: resolved.refusal, success: false };
        const target = resolved.account;

        // Only a checked reply on an existing thread goes out unattended.
        let replyTo: AgentInboxMessageItem | undefined;
        let heldBecause =
          'It is not a reply on an existing thread, so the user decides whether it goes out.';
        if (args.threadKey) {
          const checked = await checkThreadReply(target.id, {
            ...args,
            threadKey: args.threadKey,
          });
          if ('refusal' in checked) heldBecause = checked.refusal;
          else replyTo = checked.replyTo;
        }

        if (!replyTo) {
          try {
            const item = await (
              await humanRequests()
            ).requestApproval(origin(), {
              accountId: target.id,
              channel: target.kind,
              from: target.identifier,
              subject: args.subject,
              text: args.text,
              threadKey: args.threadKey,
              to: args.to,
            });

            return {
              content: parkedContent(
                item,
                `${heldBecause} It is now an approval card: the user can send it, edit it or discard it. You will be told the outcome in a later turn — do not send it again meanwhile.`,
              ),
              state: { humanRequestId: item.id },
              success: true,
            };
          } catch (error) {
            return {
              content: `Could not ask the user to approve: ${describeError(error)}`,
              success: false,
            };
          }
        }

        try {
          const service = new AgentAccountService(db, userId, {
            gateKeeper: await KeyVaultsGateKeeper.initWithEnvKey(),
            registry: createDefaultAgentAccountRegistry(),
            workspaceId,
          });

          const { providerMessageId } = await service.send(target.id, {
            replyToProviderMessageId: replyTo.providerMessageId,
            subject: args.subject,
            text: args.text,
            threadKey: args.threadKey,
            to: args.to,
          });
          return {
            content: asJson({
              from: target.identifier,
              providerMessageId,
              status: 'sent',
              to: args.to,
            }),
            success: true,
          };
        } catch (error) {
          return {
            content: `Failed to send from ${target.identifier}: ${describeError(error)}`,
            success: false,
          };
        }
      },

      waitForMessage: async (args: WaitForMessageArgs) => {
        const waitMs = Math.min(Math.max(args?.timeoutMs ?? DEFAULT_WAIT_MS, 1_000), MAX_WAIT_MS);
        const since = args?.since ? new Date(args.since) : new Date();
        const deadline = Date.now() + waitMs;

        // Resolve the requested account against the accounts this agent actually
        // owns *before* it reaches the query. The model routinely refers to an
        // account by the address it sees in context (e.g. `aria@lobe.id`), not
        // by its uuid, and `agent_inbox_messages.account_id` is a uuid column —
        // binding a non-uuid there surfaces a raw Postgres cast error (22P02)
        // instead of a usable answer. Accept either form, and turn anything the
        // agent does not own into the same authored refusal `sendMessage` gives.
        let accountId: string | undefined;
        if (args?.accountId) {
          const owned = await accounts();
          const target = owned.find(
            (account) => account.id === args.accountId || account.identifier === args.accountId,
          );
          if (!target) {
            return {
              content: `No account ${args.accountId} is owned by this agent.`,
              success: false,
            };
          }
          accountId = target.id;
        }

        const matches = (row: { from: string; subject: string | null }): boolean => {
          if (args?.from && row.from !== args.from) return false;
          if (
            args?.subjectIncludes &&
            !(row.subject ?? '').toLowerCase().includes(args.subjectIncludes.toLowerCase())
          ) {
            return false;
          }
          return true;
        };

        // Long-poll the inbox. The inbox is the single source of truth, so a
        // message delivered by the webhook while this waits is picked up here
        // with no coupling between the two paths.
        for (;;) {
          const candidates = await inbox.listSince({
            accountId,
            agentId: requireAgentId(),
            limit: 20,
            since,
          });
          const hit = candidates.find(matches);

          if (hit) {
            // The model now holds this message, so it no longer counts as
            // unread in the identity block of the following steps.
            await inbox.markRead([hit.id]);
            return {
              content: `matched: true\n${fenceUntrustedInbox([toUntrustedInboxEntry(hit)])}`,
              state: { inboxMessageId: hit.id },
              success: true,
            };
          }

          if (Date.now() >= deadline) {
            return {
              content: asJson({ matched: false, reason: 'timed-out' }),
              success: true,
            };
          }

          await sleep(POLL_INTERVAL_MS);
        }
      },
    };
  },
  identifier: AgentAccountIdentifier,
};

export { AgentAccountApiName };
