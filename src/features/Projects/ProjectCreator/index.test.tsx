import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProjectCreator from './index';

const mocks = vi.hoisted(() => ({
  hasActiveWorkspace: false,
  member: undefined as { avatar?: string; fullName?: string } | undefined,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { date?: string }) =>
      options?.date ? `${key}:${options.date}` : key,
  }),
}));

vi.mock('@/business/client/hooks/useHasActiveWorkspace', () => ({
  useHasActiveWorkspace: () => mocks.hasActiveWorkspace,
}));

vi.mock('@/business/client/hooks/useAuthorInfo', () => ({
  useAuthorInfo: () => mocks.member,
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: unknown) => unknown) =>
    selector({ isSignedIn: true, user: { avatar: '', fullName: 'Me', id: 'user_me' } }),
}));

beforeEach(() => {
  mocks.hasActiveWorkspace = false;
  mocks.member = undefined;
});

describe('ProjectCreator', () => {
  it('shows the signed-in user for a personal project, with the creation date', () => {
    render(<ProjectCreator createdAt="2026-10-01T08:00:00Z" userId="user_me" />);

    expect(screen.getByText('Me')).toBeInTheDocument();
    expect(screen.getByText('settings.createdAt:2026-10-01')).toBeInTheDocument();
  });

  it('shows the workspace member who created the project', () => {
    mocks.hasActiveWorkspace = true;
    mocks.member = { fullName: 'Sienna Owner' };

    render(<ProjectCreator createdAt="2026-10-01T08:00:00Z" userId="user_other" />);

    expect(screen.getByText('Sienna Owner')).toBeInTheDocument();
  });

  it('labels a creator who has left the workspace', () => {
    mocks.hasActiveWorkspace = true;

    render(<ProjectCreator createdAt="2026-10-01T08:00:00Z" userId="user_gone" />);

    expect(screen.getByText('settings.creatorUnknown')).toBeInTheDocument();
  });
});
