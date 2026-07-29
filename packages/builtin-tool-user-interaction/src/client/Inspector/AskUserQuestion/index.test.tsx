/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AskUserQuestionInspector } from './index';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: () => 'Ask user question',
  }),
}));

vi.mock('@lobechat/shared-tool-ui/styles', () => ({
  inspectorTextStyles: { root: 'inspector-root' },
  shinyTextStyles: { shinyText: 'shiny-text' },
}));

vi.mock('@lobehub/ui', () => ({}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: (_target, property) => String(property) }),
  cx: (...classNames: Array<string | false | undefined>) => classNames.filter(Boolean).join(' '),
}));

describe('AskUserQuestionInspector', () => {
  afterEach(cleanup);

  it('renders the API label and the first question header as a chip', () => {
    render(
      <AskUserQuestionInspector
        apiName="askUserQuestion"
        identifier="lobe-user-interaction"
        args={{
          questions: [
            {
              header: 'Direction',
              multiSelect: true,
              options: [{ description: 'Start here', label: 'Evidence pages' }],
              question: 'Which area should we explore first?',
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('Ask user question')).toBeTruthy();
    expect(screen.getByText('Direction')).toBeTruthy();
    expect(screen.queryByText(/questions:/)).toBeNull();
  });

  it('uses partial questions and the active animation while arguments stream', () => {
    render(
      <AskUserQuestionInspector
        isArgumentsStreaming
        apiName="askUserQuestion"
        args={{ questions: [] }}
        identifier="lobe-user-interaction"
        partialArgs={{
          questions: [
            {
              header: 'Next step',
              options: [],
              question: 'What should happen next?',
            },
          ],
        }}
      />,
    );

    expect(screen.getByTestId('ask-user-question-inspector').classList).toContain('shiny-text');
    expect(screen.getByText('Next step')).toBeTruthy();
  });

  it('keeps the title stable before any useful arguments arrive', () => {
    render(
      <AskUserQuestionInspector
        isArgumentsStreaming
        apiName="askUserQuestion"
        args={{ questions: [] }}
        identifier="lobe-user-interaction"
        partialArgs={{ questions: [] }}
      />,
    );

    expect(screen.getByText('Ask user question')).toBeTruthy();
    expect(screen.queryByText(/questions:/)).toBeNull();
  });

  it('summarizes multiple questions with the remaining count', () => {
    render(
      <AskUserQuestionInspector
        apiName="askUserQuestion"
        identifier="lobe-user-interaction"
        args={{
          questions: [
            { header: 'Scope', options: [], question: 'How broad should this pass be?' },
            { header: 'Tone', options: [], question: 'Which tone should we use?' },
            { header: 'Format', options: [], question: 'Which format should we use?' },
          ],
        }}
      />,
    );

    expect(screen.getByText('Scope +2')).toBeTruthy();
    expect(screen.queryByText('Tone')).toBeNull();
  });
});
