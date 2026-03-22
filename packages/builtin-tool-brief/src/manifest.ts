import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { BriefApiName } from './types';

export const BriefIdentifier = 'lobe-brief';

export const BriefManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        "Create a brief to report progress, deliver results, or request decisions from the user. Use type 'decision' when you need user input, 'result' for deliverables, 'insight' for observations. Default actions are auto-generated based on type, but you can customize them.",
      name: BriefApiName.createBrief,
      parameters: {
        properties: {
          actions: {
            description:
              'Custom action buttons for the user. If omitted, defaults are generated based on type. Each action has key (identifier), label (display text), and type ("resolve" to close, "comment" to prompt feedback).',
            items: {
              properties: {
                key: { description: 'Action identifier, e.g. "approve", "split"', type: 'string' },
                label: { description: 'Display label, e.g. "✅ 同意拆分"', type: 'string' },
                type: {
                  description: '"resolve" closes the brief, "comment" prompts for text input',
                  enum: ['resolve', 'comment'],
                  type: 'string',
                },
              },
              required: ['key', 'label', 'type'],
              type: 'object',
            },
            type: 'array',
          },
          priority: {
            description: "Priority of the brief. Default is 'normal'.",
            enum: ['urgent', 'normal', 'info'],
            type: 'string',
          },
          summary: {
            description: 'Detailed summary content of the brief.',
            type: 'string',
          },
          title: {
            description: 'A short title for the brief.',
            type: 'string',
          },
          type: {
            description:
              "The type of brief: 'decision' for user input needed, 'result' for deliverables, 'insight' for observations.",
            enum: ['decision', 'result', 'insight'],
            type: 'string',
          },
        },
        required: ['type', 'title', 'summary'],
        type: 'object',
      },
    },
    {
      description:
        'Pause execution and request the user to review your work before continuing. Use at natural review points.',
      humanIntervention: 'required',
      name: BriefApiName.requestCheckpoint,
      parameters: {
        properties: {
          reason: {
            description: 'The reason for requesting a checkpoint.',
            type: 'string',
          },
        },
        required: ['reason'],
        type: 'object',
      },
    },
  ],
  identifier: BriefIdentifier,
  meta: {
    avatar: '📋',
    description: 'Report progress, deliver results, and request user decisions',
    title: 'Brief Tools',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
