import { EvalCaptureContent } from 'verification:component';

const noop = () => {};

const draft = {
  actualOutput: 'The capital of France is Lyon.',
  context: [{ content: 'You are a geography tutor.', role: 'system' }],
  input: 'What is the capital of France?',
};

export const Fixture = () => (
  <EvalCaptureContent draft={draft} formId="capture-fixture" onSaved={noop} />
);
