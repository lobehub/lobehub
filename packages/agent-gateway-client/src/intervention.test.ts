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

  it('accepts Droid as an explicit permission provider', () => {
    expect(
      sanitizeAgentInterventionRequestForReview(
        request({ identifier: 'droid', provider: 'droid' }),
      ),
    ).toMatchObject({ interactionKind: 'permission', provider: 'droid' });
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

  it('defaults an omitted multiSelect to false but rejects explicit non-boolean values', () => {
    const omittedMultiSelect = request({
      arguments: JSON.stringify({
        questions: [
          {
            header: 'Question',
            options: [{ label: 'Continue' }, { label: 'Stop' }],
            question: 'Proceed?',
          },
        ],
      }),
      interactionKind: 'question',
    });
    expect(
      JSON.parse(sanitizeAgentInterventionRequestForReview(omittedMultiSelect)!.arguments),
    ).toMatchObject({ questions: [{ multiSelect: false }] });

    for (const invalidMultiSelect of ['false', null]) {
      const invalidRequest = request({
        arguments: JSON.stringify({
          questions: [
            {
              header: 'Question',
              multiSelect: invalidMultiSelect,
              options: [{ label: 'Continue' }, { label: 'Stop' }],
              question: 'Proceed?',
            },
          ],
        }),
        interactionKind: 'question',
      });

      expect(sanitizeAgentInterventionRequestForReview(invalidRequest)).toBeUndefined();
    }
  });

  it('fails closed when permission or plan requests are ambiguous', () => {
    for (const interactionKind of ['permission', 'plan'] as const) {
      const questions = [
        {
          header: 'Review',
          multiSelect: false,
          options: [{ id: 'allow', label: 'Allow' }],
          question: 'Proceed?',
        },
        {
          header: 'Review again',
          multiSelect: false,
          options: [{ id: 'allow', label: 'Allow' }],
          question: 'Proceed again?',
        },
      ];

      const omittedMultiSelect = sanitizeAgentInterventionRequestForReview(
        request({
          arguments: JSON.stringify({ questions: [{ ...questions[0], multiSelect: undefined }] }),
          interactionKind,
        }),
      );

      expect(JSON.parse(omittedMultiSelect!.arguments)).toMatchObject({
        questions: [{ multiSelect: false }],
      });
      expect(
        sanitizeAgentInterventionRequestForReview(
          request({ arguments: JSON.stringify({ questions }), interactionKind }),
        ),
      ).toBeUndefined();
      expect(
        sanitizeAgentInterventionRequestForReview(
          request({
            arguments: JSON.stringify({
              questions: [{ ...questions[0], multiSelect: true }],
            }),
            interactionKind,
          }),
        ),
      ).toBeUndefined();
    }
  });

  it('keeps distinct multi-select questions but rejects duplicate question text', () => {
    const questions = [
      {
        header: 'First',
        multiSelect: true,
        options: [{ label: 'One' }, { label: 'Two' }],
        question: 'Choose values?',
      },
      {
        header: 'Second',
        multiSelect: false,
        options: [{ label: 'Continue' }],
        question: 'Continue?',
      },
    ];
    const sanitized = sanitizeAgentInterventionRequestForReview(
      request({ arguments: JSON.stringify({ questions }), interactionKind: 'question' }),
    );

    expect(JSON.parse(sanitized!.arguments)).toMatchObject({
      questions: [{ multiSelect: true }, { multiSelect: false }],
    });
    expect(
      sanitizeAgentInterventionRequestForReview(
        request({
          arguments: JSON.stringify({
            questions: [questions[0], { ...questions[1], question: questions[0].question }],
          }),
          interactionKind: 'question',
        }),
      ),
    ).toBeUndefined();
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
