import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { AgentAccountApiName, AgentAccountIdentifier } from './types';

/**
 * The account tool: the **on-demand** half of the agent's identity.
 *
 * The other half is structural — accounts and the inbox are injected as
 * first-class context on every step (see the runtime's account context), so the
 * model already knows who it is and what arrived. This tool exists only for the
 * actions that cannot be state: sending, and waiting for the next arrival.
 *
 * It is deliberately **not** in `alwaysOnToolIds` / `defaultToolIds`: an agent
 * that owns no accounts should not pay a schema for it every turn. `resolveToolRules`
 * enables it only when the run reports `hasIdentityAccount`, which is exactly
 * the slot the earlier channel implementation paid unconditionally.
 */
export const AgentAccountManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'List the addresses this agent owns (email inbox, phone number) and what each can do (receive / send). The same addresses are already in your context, so only call this to re-check.',
      name: AgentAccountApiName.listAccounts,
      parameters: { properties: {}, type: 'object' },
      renderDisplayControl: 'collapsed',
    },
    {
      description:
        "Send a message from one of the agent's own addresses. Use `accountId` to pick the account; omit it to send from the first send-capable one.",
      name: AgentAccountApiName.sendMessage,
      parameters: {
        properties: {
          accountId: {
            description: 'Which account to send from. Omit to use the first send-capable one.',
            type: 'string',
          },
          subject: { description: 'Subject line (email accounts).', type: 'string' },
          text: { description: 'The message body.', type: 'string' },
          threadKey: {
            description: 'Reply within this thread when the provider supports it.',
            type: 'string',
          },
          to: { description: 'The address to send to.', type: 'string' },
        },
        required: ['to', 'text'],
        type: 'object',
      },
    },
    {
      // The wait budget stays under this so the tool always answers before the
      // runtime's hard tool timeout kills the call.
      defaultTimeoutMs: 130_000,
      description:
        "Wait for the next message to arrive on one of the agent's accounts, then return it (with any verification code it contains). Use this after triggering a login or a signup that emails/texts a code. A timeout is a normal, retryable result — not an error.",
      name: AgentAccountApiName.waitForMessage,
      parameters: {
        properties: {
          accountId: {
            description: 'Only watch this account. Omit to watch every receive-capable account.',
            type: 'string',
          },
          from: { description: 'Only match a message from this sender.', type: 'string' },
          since: {
            description:
              'Only consider messages received strictly after this ISO timestamp. Defaults to when the wait starts.',
            type: 'string',
          },
          subjectIncludes: {
            description: 'Case-insensitive substring the subject must contain.',
            type: 'string',
          },
          timeoutMs: {
            description: 'How long to wait in milliseconds. Defaults to 60000.',
            type: 'number',
          },
        },
        type: 'object',
      },
      renderDisplayControl: 'collapsed',
    },
  ],
  identifier: AgentAccountIdentifier,
  meta: {
    avatar: '📬',
    description:
      "Act on the agent's own addresses: list them, send from them, or wait for the next message",
    title: 'Agent Accounts',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
