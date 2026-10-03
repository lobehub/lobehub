import type {
  ListAccountsArgs,
  ReadInboxArgs,
  SendMessageArgs,
  WaitForMessageArgs,
} from '@lobechat/builtin-tool-agent-account';
import { AgentAccountApiName, AgentAccountIdentifier } from '@lobechat/builtin-tool-agent-account';

import { AgentAccountModel } from '@/database/models/agentAccount';
import type { AgentInboxMessageItem } from '@/database/schemas';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
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
 * `sendMessage` is the exfiltration edge. Its manifest holds any send without a
 * thread for the user's approval; a send that names a thread is checked here:
 * the thread must exist in this account's inbox, `to` must be its sender, and
 * the text must not relay a code this agent received from someone else.
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

    /** Accept either the account id or the address the model sees in context. */
    const findOwned = (list: Awaited<ReturnType<typeof accounts>>, ref: string) =>
      list.find((account) => account.id === ref || account.identifier === ref);

    /**
     * Check an unattended thread reply. Only reached when the call named a
     * thread — without one the send was already held for the user's approval
     * by the manifest's outbound audit. Returns the refusal, or the newest
     * message from the recipient on that thread, which the reply answers.
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
          refusal: `Thread ${args.threadKey} has no message from ${args.to} in this inbox, so this is not a reply. Send it without \`threadKey\` to ask the user to approve it.`,
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
          refusal: `This reply contains a verification code that ${relayed.from} sent you. Codes are never relayed to another sender without the user's approval — send it without \`threadKey\` to ask the user.`,
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
            return { content: `No account ${args.accountId} is owned by this agent.`, success: false };
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

      sendMessage: async (args: SendMessageArgs) => {
        if (!args?.to || !args?.text) {
          return { content: 'sendMessage requires both `to` and `text`.', success: false };
        }

        const list = await accounts();
        // Accept either the account id or the address the model sees in
        // context — the model refers to accounts by address, so matching only
        // on the uuid would refuse a perfectly valid `sendMessage`.
        const target = args.accountId
          ? list.find(
              (account) => account.id === args.accountId || account.identifier === args.accountId,
            )
          : list.find((account) => account.capabilities.send);

        if (!target) {
          return {
            content: args.accountId
              ? `No account ${args.accountId} is owned by this agent.`
              : 'This agent has no send-capable account yet.',
            success: false,
          };
        }

        let replyTo: AgentInboxMessageItem | undefined;
        if (args.threadKey) {
          const checked = await checkThreadReply(target.id, {
            ...args,
            threadKey: args.threadKey,
          });
          if ('refusal' in checked) return { content: checked.refusal, success: false };
          replyTo = checked.replyTo;
        }

        try {
          const service = new AgentAccountService(db, userId, {
            gateKeeper: await KeyVaultsGateKeeper.initWithEnvKey(),
            registry: createDefaultAgentAccountRegistry(),
            workspaceId,
          });

          const { providerMessageId } = await service.send(target.id, {
            replyToProviderMessageId: replyTo?.providerMessageId,
            subject: args.subject,
            text: args.text,
            threadKey: args.threadKey,
            to: args.to,
          });
          return {
            content: asJson({ from: target.identifier, providerMessageId, to: args.to }),
            success: true,
          };
        } catch (error) {
          return {
            content: `Failed to send from ${target.identifier}: ${
              error instanceof Error ? error.message : String(error)
            }`,
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
