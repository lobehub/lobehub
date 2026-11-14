import { AskUserQuestionView } from 'verification:component';

const noop = () => {};

const questions = [
  {
    header: 'Scope',
    multiSelect: true,
    options: [{ label: 'Frontend' }, { label: 'Backend' }],
    question: 'Which parts should change?',
  },
  {
    header: 'Tests',
    options: [{ label: 'Unit' }, { label: 'E2E' }],
    question: 'Which tests should run?',
  },
];

const labels = {
  customPlaceholder: 'Other',
  escapeBack: 'Back',
  escapeEnter: 'Replace all',
  escapePlaceholder: 'Answer in your own words',
  multiSelectTag: 'Multiple',
  recommendedTag: 'Recommended',
  skip: 'Skip',
  submit: 'Submit',
  supplementEnter: 'Notes',
  supplementPlaceholder: 'Add notes',
  timeExpired: 'Time expired',
  timeExpiredNoAnswer: 'Time expired without an answer',
  timeRemaining: (time: string) => `${time} left`,
};

export const Fixture = ({ variant }: { variant: string }) => {
  const escape = variant.endsWith('escape');
  return (
    <AskUserQuestionView
      isMulti
      isSubmitDisabled
      activeQuestion={escape ? undefined : questions[0]}
      activeTab={escape ? 'escape' : '0'}
      autoSubmitted={false}
      custom={{}}
      escapeActive={escape}
      escapeText=""
      expired={false}
      handleCustomChange={noop}
      handleEscapeTextChange={noop}
      handleSkip={noop}
      handleSubmit={noop}
      handleSupplementTextChange={noop}
      handleToggle={noop}
      labels={labels}
      picks={{}}
      questions={questions}
      remainingMs={0}
      setEscapeMode={noop}
      setQuestionMode={noop}
      setSupplementMode={noop}
      showCountdown={false}
      submissionFailed={false}
      submitting={false}
      supplementActive={false}
      supplementText=""
    />
  );
};
