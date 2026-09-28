import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import TestCaseEditContent from './Content';

const mocks = vi.hoisted(() => ({ close: vi.fn(), updateTestCase: vi.fn() }));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useModalContext: () => ({ close: mocks.close }),
}));
vi.mock('@/services/agentEval', () => ({
  agentEvalService: { updateTestCase: mocks.updateTestCase },
}));

describe('TestCaseEditContent', () => {
  it('keeps difficulty and tags when saving without opening Advanced', async () => {
    mocks.updateTestCase.mockResolvedValue(undefined);
    const { container } = render(
      <TestCaseEditContent
        formId="edit"
        testCase={{
          content: { expected: 'e', input: 'i' },
          datasetId: 'd1',
          id: 'tc1',
          metadata: { difficulty: 'hard', tags: ['a', 'b'] },
        }}
      />,
    );

    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => expect(mocks.updateTestCase).toHaveBeenCalledTimes(1));
    expect(mocks.updateTestCase.mock.calls[0][0].metadata).toEqual({
      difficulty: 'hard',
      tags: ['a', 'b'],
    });
  });
});
