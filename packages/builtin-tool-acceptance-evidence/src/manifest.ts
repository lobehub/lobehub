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
                  description:
                    'Use the type the criterion requires (listCriteria shows it). gif, screenshot and video must cite a fileId.',
                  enum: [
                    'dom_snapshot',
                    'gif',
                    'markdown',
                    'screenshot',
                    'text',
                    'transcript',
                    'video',
                  ],
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
    {
      description:
        'Dispute one Acceptance criterion instead of satisfying it. kind "invalid_criterion": the criterion itself is wrong — outside the requirement, contradicting it or another criterion, or impossible for any delivery; three review models rule on it at once, the majority decides, and an upheld criterion is waived. kind "missed_evidence": evidence you already submitted proves the criterion and an earlier review missed it; the next review reads your note next to that evidence. Never dispute a criterion because it is hard or you ran out of time.',
      name: AcceptanceEvidenceApiName.disputeCriterion,
      parameters: {
        properties: {
          checkItemId: {
            description: 'A criterion id returned by listCriteria.',
            type: 'string',
          },
          evidenceIds: {
            description:
              'For missed_evidence: ids of evidence already submitted to this criterion in this run that prove it.',
            items: { type: 'string' },
            type: 'array',
          },
          kind: { enum: ['invalid_criterion', 'missed_evidence'], type: 'string' },
          reason: {
            description:
              'The argument, in the language this Task is written in. For invalid_criterion, name which test applies (out of scope, contradiction, impossible) and why. For missed_evidence, say exactly where the evidence proves the criterion.',
            type: 'string',
          },
        },
        required: ['checkItemId', 'kind', 'reason'],
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
