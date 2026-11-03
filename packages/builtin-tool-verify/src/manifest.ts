import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { VerifyToolApiName } from './types';

export const VerifyToolIdentifier = 'lobe-verify';

export const VerifyToolManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Record the verdict for the delivery check you were asked to judge. Call this exactly once, after investigating, with the checkItemId you were given and your verdict. This is the only way to submit your judgement.',
      name: VerifyToolApiName.submitVerifyResult,
      parameters: {
        properties: {
          checkItemId: {
            description: 'The id of the check being judged (given to you in your instructions).',
            type: 'string',
          },
          verdict: {
            description:
              "Your judgement: 'passed' (concrete evidence the check is met), 'failed' (clearly not met), or 'uncertain' (cannot determine).",
            enum: ['passed', 'failed', 'uncertain'],
            type: 'string',
          },
          evidence: {
            description: 'The concrete evidence from the work supporting your verdict.',
            type: 'string',
          },
          reasoning: {
            description: 'Why that evidence supports your verdict.',
            type: 'string',
          },
          counterEvidence: {
            description: 'Evidence pointing the other way, if any.',
            type: 'string',
          },
          limitation: {
            description: 'What you could not verify and why.',
            type: 'string',
          },
          suggestion: {
            description: 'A concrete fix when the verdict is failed or uncertain.',
            type: 'string',
          },
        },
        required: ['checkItemId', 'verdict'],
        type: 'object',
      },
    },
  ],
  identifier: VerifyToolIdentifier,
  meta: {
    avatar: '✅',
    description: 'Submit the verdict for a single delivery check',
    title: 'Delivery Check Verifier',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
