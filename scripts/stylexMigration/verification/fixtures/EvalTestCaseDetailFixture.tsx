import { useLayoutEffect, useRef } from 'react';
import { MemoryRouter } from 'react-router';
import { EvalTestCaseDetail } from 'verification:component';

const testCase = {
  content: { expected: 'Paris', input: 'What is the capital of France?' },
  datasetId: 'dataset-1',
  evalConfig: { criteria: 'Names Paris as the capital.' },
  evalMode: 'equals',
  id: 'case-1',
  metadata: { caseId: 'geo-001' },
};

export const Fixture = ({ variant }: { variant: string }) => {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (variant.endsWith('editing'))
      ref.current?.querySelector<HTMLButtonElement>('button')?.click();
  }, [variant]);
  return (
    <MemoryRouter>
      <div ref={ref}>
        <EvalTestCaseDetail datasetName="Regression set" testCase={testCase} />
      </div>
    </MemoryRouter>
  );
};
