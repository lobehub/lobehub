/**
 * @vitest-environment happy-dom
 */
import type { ChatTopicMetadata } from '@lobechat/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import MetaHoverCard from './MetaHoverCard';

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
  it('renders nothing when the topic has no git context', () => {
    const { container } = render(<MetaHoverCard metadata={undefined} title="Topic" />);

    expect(container).toBeEmptyDOMElement();
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

  it('never shows a PR an older client recorded on the branch snapshot', () => {
    const metadata: ChatTopicMetadata = {
      workingDirectory: '/repo',
      workingDirectoryConfig: {
        git: {
          branch: 'feat/x',
          github: {
            pullRequest: {
              number: 42,
              state: 'open',
              title: 'guessed PR',
              url: 'https://github.com/lobehub/lobehub/pull/42',
            },
          },
        },
        path: '/repo',
        repoType: 'github',
      },
    };

    render(<MetaHoverCard metadata={metadata} title="Topic" />);

    expect(screen.queryByText(/guessed PR/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('feat/x')).toBeInTheDocument();
  });
});
