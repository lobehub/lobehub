import { EvalTestCaseTable } from 'verification:component';

const noop = () => {};

const testCases = [
  {
    content: { category: 'reasoning', expected: 'Paris', input: 'What is the capital of France?' },
    evalMode: 'equals',
    id: 'case-1',
    metadata: { difficulty: 'easy' },
  },
  {
    content: { input: 'Summarize the attached report in two sentences.' },
    id: 'case-2',
    metadata: { difficulty: 'hard' },
  },
];

export const Fixture = ({ variant }: { variant: string }) => (
  <EvalTestCaseTable
    datasetEvalMode="contains"
    diffFilter="all"
    pagination={{ current: 1, pageSize: 10 }}
    readOnly={variant === 'readonly'}
    search=""
    selectedId={variant === 'unselected' ? undefined : 'case-1'}
    testCases={testCases}
    total={testCases.length}
    onDelete={noop}
    onDiffFilterChange={noop}
    onEdit={noop}
    onPageChange={noop}
    onPreview={noop}
    onSearchChange={noop}
  />
);
