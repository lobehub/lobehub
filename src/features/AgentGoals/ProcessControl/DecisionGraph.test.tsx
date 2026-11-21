/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import DecisionGraph from './DecisionGraph';
import type { DecisionGraphModel } from './decisionGraphModel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const options: DecisionGraphModel['options'] = [
  { id: 'retry', label: 'Retry work', recommended: true, state: 'dim' },
  {
    description: 'Gives the task up',
    effect: 'retire',
    id: 'retire',
    label: 'Retire work',
    recommended: false,
    state: 'chosen',
  },
];

const effectLabel = { fail: 'F', retire: 'Retires the task', retry: 'R' };

describe('DecisionGraph', () => {
  it('draws the picked option, its effect and the note on the result card', () => {
    render(
      <DecisionGraph
        result={{ effectLabel, header: <span>Dana</span> }}
        root={{ question: 'Retry or retire?' }}
        model={{
          options,
          result: { actor: 'user', effect: 'retire', from: 'option', note: 'not worth it' },
        }}
      />,
    );

    expect(screen.getByText('Retry or retire?')).toBeTruthy();
    expect(screen.getByText('goalProcess.decisions.chosen')).toBeTruthy();
    expect(screen.getByText('goalProcess.decisions.recommended')).toBeTruthy();
    expect(screen.getByText('Gives the task up')).toBeTruthy();
    expect(screen.getByText('Dana')).toBeTruthy();
    expect(screen.getByText('Retires the task')).toBeTruthy();
    expect(screen.getByText('not worth it')).toBeTruthy();
  });

  it('names what raised the question and opens it', () => {
    const onOpen = vi.fn();
    render(
      <DecisionGraph
        model={{ options }}
        root={{
          context: { onOpen, title: 'Draft the rollout plan' },
          detail: 'Three attempts failed',
          question: 'q',
        }}
      />,
    );

    fireEvent.click(screen.getByText('Draft the rollout plan'));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByText('goalProcess.decisions.raisedBy')).toBeTruthy();
    expect(screen.getByText('Three attempts failed')).toBeTruthy();
    // With context to show, the root card does not repeat the question.
    expect(screen.queryByText('q')).toBeNull();
  });

  it('shows no result card while the question is open', () => {
    render(
      <DecisionGraph
        model={{ options: options.map((option) => ({ ...option, state: 'open' as const })) }}
        result={{ effectLabel, header: <span>Dana</span> }}
        root={{ question: 'q' }}
      />,
    );

    expect(screen.queryByText('Dana')).toBeNull();
    expect(
      within(screen.getByText('Retry work').closest('div')!.parentElement!).queryByText(
        'goalProcess.decisions.chosen',
      ),
    ).toBeNull();
  });
});
