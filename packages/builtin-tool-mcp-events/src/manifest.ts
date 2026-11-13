import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { McpEventsApiName, McpEventsIdentifier } from './types';

export const McpEventsManifest: BuiltinToolManifest = {
  identifier: McpEventsIdentifier,
  type: 'builtin',
  systemRole: systemPrompt,
  meta: {
    avatar: '🔔',
    title: 'MCP Events',
    description: 'Subscribe to connector events in this topic.',
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
      humanIntervention: 'always',
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
      description: 'List subscriptions for this topic.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: McpEventsApiName.unsubscribeEvent,
      humanIntervention: 'never',
      description: 'Remove a subscription from this topic.',
      parameters: {
        type: 'object',
        required: ['subscriptionId'],
        properties: {
          subscriptionId: {
            type: 'string',
            description:
              'Local subscription id returned by listSubscriptions (subscriptions[].id) or subscribeEvent (subscription.id).',
          },
        },
      },
    },
  ],
};
