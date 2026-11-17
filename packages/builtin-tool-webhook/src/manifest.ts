import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { WebhookApiName, WebhookIdentifier } from './types';

const webhookId = {
  description:
    "Id of one of this agent's webhooks, from listWebhooks (webhooks[].id) or createWebhook (webhook.id).",
  type: 'string',
} as const;

const settings = {
  autoApprove: {
    description:
      'true lets runs started by this webhook use tools without asking for approval, so anyone holding the key can make the agent act. Only when the user asks. Posting to a Channel turns it on.',
    type: 'boolean',
  },
  deliverTo: {
    description:
      "Only in a Channel conversation: where each run's answer is posted. 'thread' = the Thread this conversation is in, 'channel' = the Channel's main timeline, 'topic' = not posted (stays in the run's topic). A Channel destination turns autoApprove on. Outside a Channel only 'topic' is valid.",
    enum: ['topic', 'channel', 'thread'],
    type: 'string',
  },
  instructions: {
    description:
      "Self-contained, independently executable task for each call. The run happens later while the user is absent and receives the caller's request as input; include the goal, context and when it is done.",
    type: 'string',
  },
  name: {
    description: 'Short name the user recognizes the webhook by, e.g. the system that calls it.',
    type: 'string',
  },
  topicMode: {
    description:
      "'new' (default) runs each call in a new topic; 'reuse' continues one shared topic so calls see each other's history.",
    enum: ['new', 'reuse'],
    type: 'string',
  },
} as const;

export const WebhookManifest: BuiltinToolManifest = {
  identifier: WebhookIdentifier,
  type: 'builtin',
  systemRole: systemPrompt,
  meta: {
    avatar: '🪝',
    title: 'Webhooks',
    description:
      "Manage this agent's inbound webhooks: create a URL other systems call to run the agent, change, test, pause or delete it, read its calls, and check or end MCP Events subscriptions.",
  },
  api: [
    {
      name: WebhookApiName.listWebhooks,
      humanIntervention: 'never',
      description:
        "List this agent's webhooks: custom webhooks (kind generic) and MCP Events subscriptions (kind mcp_events), with status, URL and settings. Never includes keys.",
      parameters: {
        type: 'object',
        properties: {
          kind: {
            description:
              "Optional filter: 'generic' for custom webhooks, 'mcp_events' for MCP Events subscriptions. Omit for both.",
            enum: ['generic', 'mcp_events'],
            type: 'string',
          },
        },
      },
    },
    {
      name: WebhookApiName.createWebhook,
      humanIntervention: 'required',
      description:
        'Create a custom webhook for this agent and return its fixed URL. Every call runs the agent and uses credits. The key is not returned: the user generates it from the result card.',
      parameters: {
        type: 'object',
        properties: settings,
      },
    },
    {
      name: WebhookApiName.updateWebhook,
      humanIntervention: 'required',
      description:
        'Change a custom webhook of this agent: name, instructions, topic mode, auto-approve, pause or resume, or where its answers are posted. Only the fields given change.',
      parameters: {
        type: 'object',
        required: ['webhookId'],
        properties: {
          ...settings,
          deliverTo: {
            ...settings.deliverTo,
            description: `${settings.deliverTo.description} Omit to keep the current destination; 'topic' stops posting to a Channel.`,
          },
          paused: {
            description: 'true pauses it (calls are refused, nothing runs); false resumes it.',
            type: 'boolean',
          },
          webhookId,
        },
      },
    },
    {
      name: WebhookApiName.sendTestWebhook,
      humanIntervention: 'required',
      description:
        'Send a sample call to a custom webhook through the real receiver. It wakes the agent like a real caller would and uses credits.',
      parameters: {
        type: 'object',
        required: ['webhookId'],
        properties: { webhookId },
      },
    },
    {
      name: WebhookApiName.listWebhookCalls,
      humanIntervention: 'never',
      description:
        'List the calls a webhook received, newest first: when, a preview of what was sent, and whether it ran the agent (and in which topic) or why not.',
      parameters: {
        type: 'object',
        required: ['webhookId'],
        properties: {
          cursor: {
            additionalProperties: false,
            description: 'nextCursor from the previous listWebhookCalls result, for older calls.',
            properties: { createdAt: { type: 'string' }, id: { type: 'string' } },
            required: ['createdAt', 'id'],
            type: 'object',
          },
          webhookId,
        },
      },
    },
    {
      name: WebhookApiName.checkWebhook,
      humanIntervention: 'never',
      description:
        'Ask the MCP server whether an MCP Events subscription (kind mcp_events) still delivers, renewing or recovering it. Not for custom webhooks.',
      parameters: {
        type: 'object',
        required: ['webhookId'],
        properties: { webhookId },
      },
    },
    {
      name: WebhookApiName.deleteWebhook,
      humanIntervention: 'required',
      description:
        'Delete a webhook of this agent for good. A custom webhook stops accepting calls; an MCP Events subscription is also ended on its MCP server.',
      parameters: {
        type: 'object',
        required: ['webhookId'],
        properties: { webhookId },
      },
    },
  ],
};
