import { describe, expect, it } from 'vitest';

import { isInvalidProviderApiKeyError, toTemplateCriterionDrafts } from './TaskVerifyConfig';

describe('isInvalidProviderApiKeyError', () => {
  it.each([
    { errorType: 'InvalidProviderAPIKey' },
    { message: 'InvalidProviderAPIKey' },
    { data: { errorType: 'InvalidProviderAPIKey' } },
    { data: { errorData: { errorType: 'InvalidProviderAPIKey' } } },
  ])('recognizes the runtime error across tRPC serialization shapes', (error) => {
    expect(isInvalidProviderApiKeyError(error)).toBe(true);
  });

  it('does not classify unrelated generation errors as API key failures', () => {
    expect(isInvalidProviderApiKeyError(new Error('Provider timed out'))).toBe(false);
  });
});

describe('toTemplateCriterionDrafts', () => {
  it('removes task-local identities when snapshotting criteria for a reusable rubric', () => {
    expect(
      toTemplateCriterionDrafts([
        {
          criterionId: 'task-criterion-1',
          id: 'draft-1',
          required: true,
          title: '  Preserve the delivery contract  ',
          verifierType: 'llm',
        },
      ]),
    ).toEqual([
      {
        required: true,
        title: 'Preserve the delivery contract',
        verifierType: 'llm',
      },
    ]);
  });
});
