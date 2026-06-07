import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { LobeDeliveryCheckerApiName, LobeDeliveryCheckerIdentifier } from './types';

export const LobeDeliveryCheckerManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        "Define the delivery checks for the current Agent Run. Call this BEFORE doing substantive work, once you understand the task. Enumerate the concrete checks the deliverable must satisfy — one `criteria` entry per check — and set `title` to the user's task/goal. On confirmation the criteria and a reusable rubric are created and snapshotted onto the run; the checks run automatically when the run completes — you do NOT run them yourself.",
      name: LobeDeliveryCheckerApiName.generateVerifyPlan,
      humanIntervention: 'required',
      renderDisplayControl: 'expand',
      parameters: {
        properties: {
          title: {
            description:
              "The delivery standard's title — typically the user's task / goal in one line.",
            type: 'string',
          },
          criteria: {
            description: 'The checks the deliverable must satisfy — one entry per check.',
            items: {
              properties: {
                title: {
                  description: 'The short title of this check.',
                  type: 'string',
                },
                description: {
                  description: 'A one-sentence summary of what this check verifies.',
                  type: 'string',
                },
                instruction: {
                  description:
                    'A detailed, fine-grained judging rubric for this check: the exact pass conditions, what counts as a fail, the concrete evidence the judge must find, and edge cases to check. Write it thoroughly (multiple sentences / bullet points), not a one-liner — the judge relies on it.',
                  type: 'string',
                },
                required: {
                  description:
                    'Whether this check is required (must pass to deliver) vs optional. Default true.',
                  type: 'boolean',
                },
                verifierType: {
                  description:
                    "How it is judged. 'llm' (default) judges the deliverable with an LLM; 'agent' spawns a sub-agent that actively investigates (reads files, runs checks); 'program' runs a command (not executed in v1).",
                  enum: ['llm', 'agent', 'program'],
                  type: 'string',
                },
                onFail: {
                  description:
                    "Action on failure: 'manual' (default) or 'auto_repair' (attempt an automatic fix).",
                  enum: ['manual', 'auto_repair'],
                  type: 'string',
                },
              },
              required: ['title', 'description', 'instruction'],
              type: 'object',
            },
            type: 'array',
          },
        },
        required: ['title', 'criteria'],
        type: 'object',
      },
    },
  ],
  identifier: LobeDeliveryCheckerIdentifier,
  meta: {
    avatar: '✅',
    description:
      'Define delivery checks the agent run must satisfy; they run automatically on completion.',
    title: 'Delivery Checker',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
