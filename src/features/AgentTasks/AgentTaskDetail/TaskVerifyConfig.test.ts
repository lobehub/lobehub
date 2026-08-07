import { describe, expect, it } from 'vitest';

import { toTemplateCriterionDrafts } from './TaskVerifyConfig';

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
