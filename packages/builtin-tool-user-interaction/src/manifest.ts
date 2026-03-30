import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { UserInteractionApiName, UserInteractionIdentifier } from './types';

export const UserInteractionManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Create a UI-mediated interaction request with either structured form fields or freeform input. Returns the request in pending state.',
      humanIntervention: 'always',
      name: UserInteractionApiName.askUserQuestion,
      renderDisplayControl: 'collapsed',
      parameters: {
        properties: {
          question: {
            properties: {
              description: { type: 'string' },
              fields: {
                items: {
                  properties: {
                    key: { type: 'string' },
                    kind: {
                      enum: ['multiselect', 'select', 'text', 'textarea'],
                      type: 'string',
                    },
                    label: { type: 'string' },
                    options: {
                      items: {
                        properties: {
                          label: { type: 'string' },
                          value: { type: 'string' },
                        },
                        required: ['label', 'value'],
                        type: 'object',
                      },
                      type: 'array',
                    },
                    placeholder: { type: 'string' },
                    required: { type: 'boolean' },
                    value: {
                      oneOf: [{ type: 'string' }, { items: { type: 'string' }, type: 'array' }],
                    },
                  },
                  required: ['key', 'kind', 'label'],
                  type: 'object',
                },
                type: 'array',
              },
              id: { type: 'string' },
              metadata: {
                additionalProperties: true,
                type: 'object',
              },
              mode: {
                enum: ['form', 'freeform'],
                type: 'string',
              },
              prompt: { type: 'string' },
            },
            required: ['id', 'mode', 'prompt'],
            type: 'object',
          },
        },
        required: ['question'],
        type: 'object',
      },
    },
    {
      description:
        "Record the user's submitted response for a pending interaction request. In normal product flows, this is usually handled by the client or framework after the user submits in the UI.",
      name: UserInteractionApiName.submitUserResponse,
      parameters: {
        properties: {
          requestId: {
            description: 'The interaction request ID to submit a response for.',
            type: 'string',
          },
          response: {
            additionalProperties: true,
            description: "The user's response data.",
            type: 'object',
          },
        },
        required: ['requestId', 'response'],
        type: 'object',
      },
    },
    {
      description:
        'Mark a pending interaction request as skipped with an optional reason. In normal product flows, this is usually handled by the client or framework after the user skips in the UI.',
      name: UserInteractionApiName.skipUserResponse,
      parameters: {
        properties: {
          reason: {
            description: 'Optional reason for skipping.',
            type: 'string',
          },
          requestId: {
            description: 'The interaction request ID to skip.',
            type: 'string',
          },
        },
        required: ['requestId'],
        type: 'object',
      },
    },
    {
      description:
        'Cancel a pending interaction request. In normal product flows, this is usually handled by the client or framework after the user cancels in the UI.',
      name: UserInteractionApiName.cancelUserResponse,
      parameters: {
        properties: {
          requestId: {
            description: 'The interaction request ID to cancel.',
            type: 'string',
          },
        },
        required: ['requestId'],
        type: 'object',
      },
    },
    {
      description:
        'Inspect the current state of a known interaction request. Use for recovery or diagnostics, not routine polling.',
      name: UserInteractionApiName.getInteractionState,
      parameters: {
        properties: {
          requestId: {
            description: 'The interaction request ID to query.',
            type: 'string',
          },
        },
        required: ['requestId'],
        type: 'object',
      },
      renderDisplayControl: 'collapsed',
    },
  ],
  identifier: UserInteractionIdentifier,
  meta: {
    avatar: '💬',
    description: 'Ask users questions through UI interactions and observe their lifecycle outcomes',
    title: 'User Interaction',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
