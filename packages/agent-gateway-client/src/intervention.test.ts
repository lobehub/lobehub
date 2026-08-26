import { describe, expect, it } from 'vitest';

import { sanitizeAgentInterventionRequestForReview } from './intervention';
import type { AgentInterventionRequestData } from './types';

const request = (overrides: Partial<AgentInterventionRequestData> = {}) => ({
  apiName: 'askUserQuestion',
  arguments: JSON.stringify({
    ignoredRawToolField: 'secret',
    questions: [
      {
        header: 'Permission',
        multiSelect: false,
        options: [
          { id: 'allow_once', ignored: 'secret', label: 'Allow' },
          { id: 'deny', label: 'Deny' },
        ],
        question: 'Edit README?',
      },
    ],
  }),
  deadline: Date.now() + 60_000,
  identifier: 'claude-code',
  interactionKind: 'permission' as const,
  provider: 'cursor' as const,
  toolCallId: 'permission-1',
  ...overrides,
});

describe('sanitizeAgentInterventionRequestForReview', () => {
  it('keeps only canonical review fields and exact provider option ids', () => {
    const sanitized = sanitizeAgentInterventionRequestForReview(request());

    expect(JSON.parse(sanitized!.arguments)).toEqual({
      questions: [
        {
          header: 'Permission',
          multiSelect: false,
          options: [
            { id: 'allow_once', label: 'Allow' },
            { id: 'deny', label: 'Deny' },
          ],
          question: 'Edit README?',
        },
      ],
    });
  });

  it('fails closed when a permission option lacks an id or ids are duplicated', () => {
    const missingId = request({
      arguments: JSON.stringify({
        questions: [
          {
            header: 'Permission',
            multiSelect: false,
            options: [{ label: 'Allow' }],
            question: 'Proceed?',
          },
        ],
      }),
    });
    const duplicateIds = request({
      arguments: JSON.stringify({
        questions: [
          {
            header: 'Permission',
            multiSelect: false,
            options: [
              { id: 'same', label: 'Allow' },
              { id: 'same', label: 'Deny' },
            ],
            question: 'Proceed?',
          },
        ],
      }),
    });

    expect(sanitizeAgentInterventionRequestForReview(missingId)).toBeUndefined();
    expect(sanitizeAgentInterventionRequestForReview(duplicateIds)).toBeUndefined();
  });

  it('requires explicit provider and interaction kind for durable review', () => {
    expect(
      sanitizeAgentInterventionRequestForReview(request({ provider: undefined })),
    ).toBeUndefined();
    expect(
      sanitizeAgentInterventionRequestForReview(request({ interactionKind: undefined })),
    ).toBeUndefined();
  });
});
