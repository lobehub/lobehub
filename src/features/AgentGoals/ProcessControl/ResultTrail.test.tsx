/**
 * @vitest-environment happy-dom
 */
import { GOAL_REPORT_TASK_TITLE } from '@lobechat/const/goal';
import type { GoalReportMetadata, GoalReportState } from '@lobechat/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GoalGraphView, GoalNodeView } from './goalGraphViewModel';
import ResultTrail from './ResultTrail';

const chatState = vi.hoisted(() => ({
  openDocument: vi.fn(),
  openGoalReport: vi.fn(),
  openGoalReportChapter: vi.fn(),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
}));

vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Markdown: ({ children }: { children: string }) => <div>{children}</div>,
    Tooltip: ({ children, title }: { children: React.ReactNode; title: React.ReactNode }) => (
      <>
        {children}
        <div data-testid={'tooltip'}>{title}</div>
      </>
    ),
  };
});

const at = (minutes: number) => new Date(Date.UTC(2026, 8, 28, 0, minutes));

const view = (id: string, kind: string, minutes: number, extra: object = {}) =>
  ({
    attempts: [],
    node: {
      createdAt: at(minutes),
      id,
      kind,
      resolvedAt: at(minutes),
      status: 'resolved',
      title: id,
      updatedAt: at(minutes),
    },
    ...extra,
  }) as unknown as GoalNodeView;

const taskA = view('Collect sources', 'task', 1);
const wrapUp = view('wrap', 'task', 9);
(wrapUp.node as { title: string }).title = GOAL_REPORT_TASK_TITLE;
const finding = view('Sources agree', 'finding', 2, { producedBy: taskA.node });
const deadEnd = view('Scrape old API', 'task', 3);

const deliverable = {
  createdAt: at(4),
  identifier: null,
  nodeId: 'Collect sources',
  resourceId: 'docs_1',
  title: 'Source list',
  type: 'document',
  url: null,
  workId: 'wk-1',
  workVersionId: 'v-1',
};

const metadata = {
  chapters: [
    {
      detours: [
        {
          kind: 'dead_end',
          lesson: 'Check the API first',
          nodeIds: ['Scrape old API'],
          reason: 'The old API was retired',
          title: 'Scraping the old API',
        },
      ],
      findingIds: ['Sources agree'],
      narrative: 'We began by gathering every source.',
      nodeIds: ['Collect sources'],
      title: 'Gathering the sources',
      workVersionIds: ['v-1'],
    },
  ],
  graphCursor: 'evt-1',
  headline: 'Shipped the brief',
  nextSteps: [],
} satisfies GoalReportMetadata;

const graph = (report?: Partial<GoalReportState>): GoalGraphView =>
  ({
    artifacts: [deliverable],
    byId: {
      'Collect sources': taskA,
      'Scrape old API': deadEnd,
      'Sources agree': finding,
      'wrap': wrapUp,
    },
    findings: [finding],
    goal: { id: 'goal-1', status: 'achieved' },
    nodes: [taskA, deadEnd, finding, wrapUp],
    report: report && {
      dispatch: { acceptanceKey: 'k', dispatchedAt: '', nodeId: 'wrap', trigger: 'accepted' },
      status: 'completed',
      ...report,
    },
  }) as unknown as GoalGraphView;

const latest = {
  content: '# Full report',
  createdAt: at(10),
  metadata,
  version: 1,
  workId: 'wk-report',
  workVersionId: 'v-report',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ResultTrail', () => {
  /**
   * The 探索过程 section follows the wrap-up run as the graph poll brings each
   * snapshot: organizing → storyline, with no reload in between; and back to
   * the derived trail when the run fails.
   */
  it('switches from the organizing state to the storyline as the report lands', () => {
    const { rerender } = render(
      <ResultTrail graph={graph({ status: 'running' })} onSelect={vi.fn()} />,
    );

    expect(screen.getByText('goalProcess.result.story.pending')).toBeTruthy();
    expect(screen.queryByText('Collect sources')).toBeNull();

    rerender(<ResultTrail graph={graph({ latest, status: 'completed' })} onSelect={vi.fn()} />);

    expect(screen.queryByText('goalProcess.result.story.pending')).toBeNull();
    expect(screen.getByText('Gathering the sources')).toBeTruthy();
    expect(screen.getByText('We began by gathering every source.')).toBeTruthy();
    // The chapter's conclusion and deliverable are its list items.
    expect(screen.getByText('Sources agree')).toBeTruthy();
    expect(screen.getByText('Source list')).toBeTruthy();
  });

  it('shows the detour hint with its reason and opens the chapter map', () => {
    render(<ResultTrail graph={graph({ latest, status: 'completed' })} onSelect={vi.fn()} />);

    const hint = screen.getByRole('button', { name: /goalProcess.result.story.detours:1/ });
    expect(screen.getByTestId('tooltip').textContent).toContain('The old API was retired');

    fireEvent.click(hint);
    expect(chatState.openGoalReportChapter).toHaveBeenCalledWith('goal-1', 0);
  });

  // A conclusion opens beside the page instead of unfolding into the trail, in
  // both the storyline and the derived trail.
  it('opens a finding in the side panel instead of expanding it inline', () => {
    const finding = { ...graph().byId['Sources agree'] };
    (finding.node as { description?: string }).description = 'Three sources agree on the date.';

    for (const snapshot of [graph({ latest, status: 'completed' }), graph()]) {
      const onSelect = vi.fn();
      const { unmount } = render(<ResultTrail graph={snapshot} onSelect={onSelect} />);

      fireEvent.click(screen.getByRole('button', { name: /Sources agree/ }));

      expect(onSelect).toHaveBeenCalledWith('Sources agree');
      expect(screen.queryByText('Three sources agree on the date.')).toBeNull();
      unmount();
    }
  });

  it('opens the full report beside the page', () => {
    render(<ResultTrail graph={graph({ latest, status: 'completed' })} onSelect={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /goalProcess.result.story.readReport/ }));
    expect(chatState.openGoalReport).toHaveBeenCalledWith('goal-1');
  });

  it('falls back to the derived trail when the wrap-up failed or never ran', () => {
    for (const snapshot of [graph({ status: 'failed' }), graph()]) {
      const { unmount } = render(<ResultTrail graph={snapshot} onSelect={vi.fn()} />);

      expect(screen.queryByText('goalProcess.result.story.pending')).toBeNull();
      expect(screen.queryByText('Gathering the sources')).toBeNull();
      // The derived step is the task itself; the wrap-up Task is not a step.
      expect(screen.getByText('Collect sources')).toBeTruthy();
      expect(screen.queryByText(GOAL_REPORT_TASK_TITLE)).toBeNull();
      unmount();
    }
  });
});
