import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { McpEventsApiName, McpEventsIdentifier } from './types';

const subscriptionId = {
  type: 'string',
  description:
    "Id of one of this agent's subscriptions you made, from listSubscriptions (subscriptions[].id) or subscribeEvent (subscription.id). Any topic; not a custom webhook id.",
} as const;

export const McpEventsManifest: BuiltinToolManifest = {
  identifier: McpEventsIdentifier,
  type: 'builtin',
  systemRole: systemPrompt,
  meta: {
    avatar: '🔔',
    title: 'MCP Events',
    description:
      "Subscribe to connector events in this topic, and list, rename, check or remove this agent's subscriptions.",
  },
  api: [
    {
      name: McpEventsApiName.listEventTypes,
      humanIntervention: 'never',
      description:
        'List event types from available connectors. Only webhook event types can be subscribed to.',
      parameters: {
        type: 'object',
        properties: {
          connector: {
            type: 'string',
            description:
              'Optional connector identifier (not its display name), as returned in connector.identifier by listEventTypes. Omit to list all available event connectors.',
          },
        },
      },
    },
    {
      name: McpEventsApiName.subscribeEvent,
      // Asks like any tool that needs approval: an auto-run user is not asked.
      humanIntervention: 'required',
      description:
        'Subscribe in this topic with approved handling instructions. Each event runs the agent and uses credits.',
      parameters: {
        type: 'object',
        required: ['connector', 'name', 'instructions'],
        properties: {
          connector: {
            type: 'string',
            description:
              'Connector identifier from listEventTypes connector.identifier; do not use its display name or database ID.',
          },
          name: {
            type: 'string',
            description:
              'Exact event type name from listEventTypes. Choose an event whose subscribable field is true.',
          },
          arguments: {
            type: 'object',
            additionalProperties: true,
            description:
              'Subscription arguments matching this event type inputSchema from listEventTypes (filters and other event-specific options). Omit when the schema needs no arguments.',
          },
          title: {
            type: 'string',
            description:
              'Optional display name for people, shown in the automation lists (e.g. "New bugs in Web team"); it can be renamed later. Use the name the user gave; omit to show the event name.',
          },
          deliverTo: {
            type: 'string',
            enum: ['thread', 'channel'],
            description:
              "Only when this conversation is a Channel Thread: 'thread' (default) posts each event's result to this Thread, 'channel' to the Channel's main timeline. Omit elsewhere.",
          },
          instructions: {
            type: 'string',
            description:
              'Self-contained, independently executable instructions for what the agent should do when an event arrives. That run occurs later while the user is absent; include the goal, context and completion conditions it needs.',
          },
        },
      },
    },
    {
      name: McpEventsApiName.listSubscriptions,
      humanIntervention: 'never',
      description:
        "List subscriptions: this topic's by default, or with scope 'agent' every subscription of this agent that you made, in any topic. Each has a display name (name) and the fixed event it follows (eventName).",
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['topic', 'agent'],
            description:
              "'topic' (default) lists this topic's subscriptions; 'agent' lists every subscription of this agent that you made, with the topic each runs in.",
          },
        },
      },
    },
    {
      name: McpEventsApiName.renameSubscription,
      humanIntervention: 'never',
      description:
        'Change the display name people see for a subscription. Its eventName, what it follows and what wakes the agent stay the same.',
      parameters: {
        type: 'object',
        required: ['subscriptionId', 'name'],
        properties: {
          name: {
            type: 'string',
            description:
              'New display name, e.g. the name the user asked for. An empty string shows the event name again.',
          },
          subscriptionId,
        },
      },
    },
    {
      name: McpEventsApiName.checkSubscription,
      humanIntervention: 'never',
      description:
        'Ask the MCP server whether a subscription still delivers, renewing or recovering it, and return its current status. Can be repeated after 30 seconds.',
      parameters: {
        type: 'object',
        required: ['subscriptionId'],
        properties: { subscriptionId },
      },
    },
    {
      name: McpEventsApiName.unsubscribeEvent,
      // It reaches the agent's subscriptions in every topic, so it asks like deleting a webhook.
      humanIntervention: 'required',
      description:
        'Remove a subscription of this agent that you made, in any topic, and end it on its MCP server.',
      parameters: {
        type: 'object',
        required: ['subscriptionId'],
        properties: { subscriptionId },
      },
    },
  ],
};
