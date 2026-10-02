import type {
  ListAccountsArgs,
  SendMessageArgs,
  WaitForMessageArgs,
} from '@lobechat/builtin-tool-agent-account';
import { AgentAccountApiName, AgentAccountIdentifier } from '@lobechat/builtin-tool-agent-account';

import { AgentAccountModel } from '@/database/models/agentAccount';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { AgentAccountService } from '@/server/services/agentIdentity';
import { AgentInboxService } from '@/server/services/agentIdentity/inbox';
import { createDefaultAgentAccountRegistry } from '@/server/services/agentIdentity/providers';

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const asJson = (value: unknown) => JSON.stringify(value, null, 2);

/**
 * Server runtime for the agent-account tool.
 *
 * The account *state* (addresses + inbox) reaches the model as context, not
 * through here. These three APIs are the actions: list, send, and wait. All
 * three are scoped to the run's agent — an account id that belongs to someone
 * else is refused, so the tool cannot be used as a confused deputy.
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
      });

    const inbox = new AgentInboxService(db, userId, workspaceId);

    return {
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
        const target = args.accountId
          ? list.find((account) => account.id === args.accountId)
          : list.find((account) => account.capabilities.send);

        if (!target) {
          return {
            content: args.accountId
              ? `No account ${args.accountId} is owned by this agent.`
              : 'This agent has no send-capable account yet.',
            success: false,
          };
        }

        try {
          const service = new AgentAccountService(db, userId, {
            gateKeeper: await KeyVaultsGateKeeper.initWithEnvKey(),
            registry: createDefaultAgentAccountRegistry(),
            workspaceId,
          });

          const { providerMessageId } = await service.send(target.id, {
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
            accountId: args?.accountId,
            agentId: requireAgentId(),
            limit: 20,
            since,
          });
          const hit = candidates.find(matches);

          if (hit) {
            return {
              content: asJson({
                matched: true,
                message: {
                  codes: hit.codes ?? [],
                  from: hit.from,
                  receivedAt: hit.receivedAt.toISOString(),
                  subject: hit.subject ?? undefined,
                  text: hit.text,
                },
              }),
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
