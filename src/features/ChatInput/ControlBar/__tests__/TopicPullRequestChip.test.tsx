/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TopicPullRequestChip from '../TopicPullRequestChip';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  result: { primary: undefined as any, probes: [] as any[], views: [] as any[] },
}));

vi.mock('@/features/TopicPullRequests/useTopicPullRequests', () => ({
  useTopicPullRequests: () => mocks.result,
}));
vi.mock('@/features/TopicPullRequests/TopicPullRequestProbes', () => ({
  default: ({ probes }: { probes: { number: number }[] }) => (
    <span data-numbers={probes.map((p) => p.number).join(',')} data-testid="probes" />
  ),
}));
vi.mock('@/utils/openTrustedExternalUrl', () => ({ openTrustedExternalUrl: mocks.open }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  DropdownMenu: ({ children, items }: any) => (
    <div data-testid="menu">
      {children}
      {items.map((item: any) => (
        <button key={item.key} onClick={item.onClick}>
          {item.label}
        </button>
      ))}
    </div>
  ),
  Tooltip: ({ children }: any) => children,
}));

const view = (number: number, state = 'open') => ({
  identifier: `lobehub/lobehub#${number}`,
  number,
  repoFullName: 'lobehub/lobehub',
  state,
  title: `PR ${number}`,
  url: `https://github.com/lobehub/lobehub/pull/${number}`,
});

describe('TopicPullRequestChip', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders only the device probes while no PR is linked', () => {
    mocks.result = { primary: undefined, probes: [], views: [] };
    render(<TopicPullRequestChip path="/repo" topicId="t1" />);

    expect(screen.queryByTestId('topic-pull-request-chip')).toBeNull();
    expect(screen.getByTestId('probes')).toBeInTheDocument();
  });

  it('opens the only linked PR directly', () => {
    mocks.result = { primary: view(12), probes: [{ number: 12, version: 1 }], views: [view(12)] };
    render(<TopicPullRequestChip path="/repo" topicId="t1" />);

    const chip = screen.getByTestId('topic-pull-request-chip');
    expect(chip).toHaveTextContent('#12');
    expect(chip).not.toHaveTextContent('+');
    fireEvent.click(chip);
    expect(mocks.open).toHaveBeenCalledWith('https://github.com/lobehub/lobehub/pull/12');
  });

  it('shows the latest open PR plus the count, and lists them all', () => {
    const views = [view(13, 'merged'), view(12)];
    mocks.result = {
      primary: views[1],
      probes: [
        { number: 13, version: 1 },
        { number: 12, version: 1 },
      ],
      views,
    };
    render(<TopicPullRequestChip path="/repo" topicId="t1" />);

    expect(screen.getByTestId('topic-pull-request-chip')).toHaveTextContent('#12+1');
    fireEvent.click(screen.getByText('#13 PR 13'));
    expect(mocks.open).toHaveBeenCalledWith('https://github.com/lobehub/lobehub/pull/13');
    expect(screen.getByText('#12 PR 12')).toBeInTheDocument();
  });
});
