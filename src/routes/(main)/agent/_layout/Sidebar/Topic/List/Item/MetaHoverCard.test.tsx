/**
 * @vitest-environment happy-dom
 */
import type { ChatTopicMetadata } from '@lobechat/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import MetaHoverCard from './MetaHoverCard';

vi.mock('@lobehub/ui', () => ({
  Icon: () => <span data-testid="meta-card-icon" />,
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

describe('MetaHoverCard', () => {
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
