import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { AcceptanceEvidenceApiName } from './types';

export const AcceptanceEvidenceIdentifier = 'lobe-acceptance-evidence';

export const AcceptanceEvidenceManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'List the Acceptance criteria of the run you are working in, with the evidence already recorded for each. Call this first: criterion ids are minted when the run starts or authored by you, so they cannot be named in your instructions.',
      name: AcceptanceEvidenceApiName.listCriteria,
      parameters: { properties: {}, type: 'object' },
    },
    {
      description:
        'Author the Acceptance checklist for a run that has none — call this only when listCriteria reports no criteria for the run. Each item is a standard the delivery must meet; the verifier judges your items like any other criterion, so state real standards rather than restating the task. A run that already has criteria keeps them.',
      name: AcceptanceEvidenceApiName.authorCriteria,
      parameters: {
        properties: {
          items: {
            description:
              'The standards this delivery must meet, one item per standard, in the order you will evidence them.',
            items: {
              properties: {
                description: {
                  description:
                    'What the standard means and what evidence would prove it, in one or two sentences.',
                  type: 'string',
                },
                required: {
                  default: true,
                  description: 'Whether failing this standard blocks delivery (default true).',
                  type: 'boolean',
                },
                title: {
                  description:
                    'One-sentence standard, e.g. "Both transport packages are published in their own PRs".',
                  type: 'string',
                },
              },
              required: ['title'],
              type: 'object',
            },
            minItems: 1,
            type: 'array',
          },
        },
        required: ['items'],
        type: 'object',
      },
    },
    {
      description:
        'Submit evidence produced by your work for one Acceptance criterion. This records evidence only; it does not decide the verdict.',
      name: AcceptanceEvidenceApiName.submitEvidence,
      parameters: {
        properties: {
          checkItemId: {
            description: 'A criterion id returned by listCriteria.',
            type: 'string',
          },
          evidence: {
            description: 'One or more concrete artifacts or observations produced by the work.',
            items: {
              properties: {
                content: { description: 'Inline evidence content.', type: 'string' },
                description: {
                  description:
                    'Required for file artifacts, including file contents submitted inline. A non-empty, reviewer-facing sentence explaining what the artifact contains and what it demonstrates for this criterion. A filename, path, id, or generic label alone is insufficient.',
                  type: 'string',
                },
                documentId: {
                  description:
                    'An existing LobeHub document id from documents.id. Do not use an agent_documents.id binding id.',
                  type: 'string',
                },
                fileId: { description: 'An existing LobeHub artifact file id.', type: 'string' },
                type: {
                  enum: ['markdown', 'screenshot', 'text', 'video'],
                  type: 'string',
                },
              },
              required: ['type'],
              type: 'object',
            },
            type: 'array',
          },
        },
        required: ['checkItemId', 'evidence'],
        type: 'object',
      },
    },
  ],
  identifier: AcceptanceEvidenceIdentifier,
  meta: {
    avatar: '🧾',
    description: 'Submit builder-owned evidence for Acceptance criteria',
    title: 'Acceptance Evidence',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
