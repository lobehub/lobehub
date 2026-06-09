// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  type OrganizationDetailContextConfig,
  OrganizationDetailProvider,
} from '../DetailProvider';
import OrganizationHeader from './index';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/routes/(main)/community/(detail)/features/FollowButton', () => ({
  default: ({ userId }: { userId: number }) => <button>follow-{userId}</button>,
}));

vi.mock('../FollowStats', () => ({
  default: () => <div>organization-follow-stats</div>,
}));

vi.mock('./Banner', () => ({
  default: () => <div data-testid="organization-banner" />,
}));

const createConfig = (
  overrides: Partial<OrganizationDetailContextConfig> = {},
): OrganizationDetailContextConfig => ({
  agentCount: 0,
  agentGroups: [],
  agents: [],
  groupCount: 0,
  plugins: [],
  skills: [],
  totalInstalls: 0,
  user: {
    avatarUrl: null,
    bannerUrl: null,
    createdAt: '',
    description: 'An organization profile',
    displayName: 'Acme Labs',
    followersCount: 2,
    followingCount: 0,
    id: 42,
    namespace: 'acme-labs',
    socialLinks: { website: 'https://acme.example' },
    type: 'organization',
    userName: null,
  },
  ...overrides,
});

describe('OrganizationHeader', () => {
  it('identifies the page as an organization account and keeps follow controls separate', () => {
    render(
      <OrganizationDetailProvider config={createConfig()}>
        <OrganizationHeader />
      </OrganizationDetailProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Acme Labs' })).toBeInTheDocument();
    expect(screen.getByText('user.accountType.organization')).toBeInTheDocument();
    expect(screen.getByText('@acme-labs')).toBeInTheDocument();
    expect(screen.getByText('organization-follow-stats')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'follow-42' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'user.editProfile' })).not.toBeInTheDocument();
  });
});
