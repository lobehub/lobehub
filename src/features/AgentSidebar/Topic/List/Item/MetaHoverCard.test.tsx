/**
 * @vitest-environment happy-dom
 */
import type { ChatTopicMetadata } from '@lobechat/types';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import MetaHoverCard from './MetaHoverCard';

const fetchTopicLinkedPullRequestMock = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui', () => ({
  Icon: () => <span data-testid="meta-card-icon" />,
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: unknown) => unknown) =>
    selector({ useFetchTopicLinkedPullRequest: fetchTopicLinkedPullRequestMock }),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({
    card: 'card',
    header: 'header',
    headerTime: 'headerTime',
    headerTitle: 'headerTitle',
    prLink: 'prLink',
    row: 'row',
    rowIcon: 'rowIcon',
    rowText: 'rowText',
  }),
  cssVar: {
    colorError: '#f00',
    colorSuccess: '#0f0',
    colorTextTertiary: '#999',
    colorWarning: '#fa0',
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values?.sha ? `${key}:${values.sha}` : key,
  }),
}));

vi.mock('@/const/version', () => ({ isDesktop: false }));

vi.mock('@/features/ChatInput/ControlBar/DirIcon', () => ({
  default: ({ size }: { size?: number }) => <span data-size={size} data-testid="dir-icon" />,
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('MetaHoverCard', () => {
  it('re-fetches the linked PR state on mount (popover open) for the hovered topic', () => {
    const metadata: ChatTopicMetadata = {
      workingDirectory: '/repo',
      workingDirectoryConfig: {
        git: {
          branch: 'fix/cold-hydration-cache-inject',
          github: {
            pullRequest: {
              number: 17_392,
              state: 'open',
              title: 'keep the hydration gate up',
              url: 'https://github.com/lobehub/lobehub/pull/17392',
            },
            pullRequestStatus: 'ok',
          },
        },
        path: '/repo',
        repoType: 'github',
      },
    };

    render(<MetaHoverCard metadata={metadata} title="Topic" topicId="topic-1" />);

    // The card mounts only while the hover popover is open, so wiring the SWR
    // hook to the topic id is what turns "open the card" into a PR refresh —
    // background topics otherwise keep their last persisted snapshot forever.
    expect(fetchTopicLinkedPullRequestMock).toHaveBeenCalledWith('topic-1', metadata);
  });

  it('still mounts the refresh hook when the topic has no git context', () => {
    const { container } = render(<MetaHoverCard metadata={undefined} title="Topic" />);

    // No git context → nothing renders, but the hook is still called
    // unconditionally (rules of hooks); it no-ops via a null SWR key.
    expect(container).toBeEmptyDOMElement();
    expect(fetchTopicLinkedPullRequestMock).toHaveBeenCalledWith(undefined, undefined);
  });

  it('shows persisted git context without the branch explanation note', () => {
    const metadata: ChatTopicMetadata = {
      workingDirectory: '/repo-fix',
      workingDirectoryConfig: {
        git: { activeWorktree: '/repo-fix', branch: 'fix', isWorktree: true },
        path: '/repo',
        repoType: 'git',
      },
    };

    render(<MetaHoverCard metadata={metadata} time={<span>00:33</span>} title="Topic" />);

    expect(screen.getByText('Topic')).toBeInTheDocument();
    expect(screen.getByText('00:33')).toBeInTheDocument();
    expect(screen.getByText('repo')).toBeInTheDocument();
    expect(screen.getByText('fix')).toBeInTheDocument();
    expect(screen.getByText('repo-fix')).toBeInTheDocument();
    expect(screen.queryByText('metaCard.branchNote')).not.toBeInTheDocument();
  });

  it('renders the PR number ahead of the title so the ellipsis never eats it', () => {
    const metadata: ChatTopicMetadata = {
      workingDirectory: '/repo',
      workingDirectoryConfig: {
        git: {
          branch: 'perf/active-scope-key',
          github: {
            pullRequest: {
              ciStatus: 'success',
              mergedAt: '2026-07-09T00:00:00.000Z',
              number: 16_951,
              state: 'closed',
              title: 'perf(swr): persist activeScopeKey',
              url: 'https://github.com/lobehub/lobehub/pull/16951',
            },
          },
        },
        path: '/repo',
        repoType: 'git',
      },
    };

    render(<MetaHoverCard metadata={metadata} title="Topic" />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://github.com/lobehub/lobehub/pull/16951');
    expect(link).toHaveTextContent('metaCard.pr.merged · #16951 perf(swr): persist activeScopeKey');
    expect(screen.getByTitle('#16951 perf(swr): persist activeScopeKey')).toBeInTheDocument();
  });
});
