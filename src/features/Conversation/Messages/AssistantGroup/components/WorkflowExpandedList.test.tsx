/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WORKFLOW_LIST_INITIAL_STEPS, WORKFLOW_LIST_LOAD_MORE_STEPS } from '../constants';
import type { RenderableAssistantContentBlock } from './types';
import WorkflowExpandedList from './WorkflowExpandedList';

vi.mock('./ContentBlock', () => ({
  default: ({ id }: RenderableAssistantContentBlock) => (
    <div data-block-id={id} data-testid="content-block" />
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => `${key}:${options?.count}`,
  }),
}));

const makeBlocks = (count: number): RenderableAssistantContentBlock[] =>
  Array.from({ length: count }, (_, i) => ({ content: '', id: `b${i}` }));

const renderedIds = () =>
  screen.getAllByTestId('content-block').map((node) => node.getAttribute('data-block-id'));

describe('WorkflowExpandedList', () => {
  /** @example Opening a 571-step workflow mounted every step at once and froze the page. */
  it('mounts only the latest steps of a long workflow', () => {
    const total = WORKFLOW_LIST_INITIAL_STEPS + WORKFLOW_LIST_LOAD_MORE_STEPS + 20;
    render(<WorkflowExpandedList assistantId="g1" blocks={makeBlocks(total)} />);

    const ids = renderedIds();
    expect(ids).toHaveLength(WORKFLOW_LIST_INITIAL_STEPS);
    expect(ids.at(-1)).toBe(`b${total - 1}`);
    expect(
      screen.getByText(`workflow.showEarlierSteps:${total - WORKFLOW_LIST_INITIAL_STEPS}`),
    ).toBeInTheDocument();
  });

  it('loads earlier steps above the loaded ones on demand', () => {
    const total = WORKFLOW_LIST_INITIAL_STEPS + WORKFLOW_LIST_LOAD_MORE_STEPS + 20;
    render(<WorkflowExpandedList assistantId="g1" blocks={makeBlocks(total)} />);

    fireEvent.click(
      screen.getByText(`workflow.showEarlierSteps:${total - WORKFLOW_LIST_INITIAL_STEPS}`),
    );
    expect(renderedIds()).toHaveLength(WORKFLOW_LIST_INITIAL_STEPS + WORKFLOW_LIST_LOAD_MORE_STEPS);
    expect(screen.getByText('workflow.showEarlierSteps:20')).toBeInTheDocument();

    fireEvent.click(screen.getByText('workflow.showEarlierSteps:20'));
    expect(renderedIds()).toHaveLength(total);
    expect(renderedIds()[0]).toBe('b0');
    expect(screen.queryByText(/workflow\.showEarlierSteps/)).toBeNull();
  });

  it('renders a short workflow whole without the control', () => {
    render(<WorkflowExpandedList assistantId="g1" blocks={makeBlocks(3)} />);

    expect(renderedIds()).toEqual(['b0', 'b1', 'b2']);
    expect(screen.queryByText(/workflow\.showEarlierSteps/)).toBeNull();
  });
});
