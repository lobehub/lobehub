import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { AcceptanceEvidenceApiName } from './types';

export const AcceptanceEvidenceIdentifier = 'lobe-acceptance-evidence';

export const AcceptanceEvidenceManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'List the Acceptance criteria of the run you are working in, with the evidence already recorded for each. Call this first: criterion ids are minted when the run starts, so they cannot be named in your instructions.',
      name: AcceptanceEvidenceApiName.listCriteria,
      parameters: { properties: {}, type: 'object' },
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
                description: { description: 'What this evidence demonstrates.', type: 'string' },
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
