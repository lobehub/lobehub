import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as FavoritesModule from '@/features/Favorites';
import type { ProjectListItem } from '@/store/project';

import ProjectItem from './ProjectItem';

const permission = vi.hoisted(() => ({ allowed: true }));
const favorite = vi.hoisted(() => ({ path: undefined as string | undefined }));

vi.mock('@/features/Favorites', async (importOriginal) => {
  const actual = await importOriginal<typeof FavoritesModule>();
  return {
    ...actual,
    useFavoriteMenuItem: (...args: Parameters<typeof actual.useFavoriteMenuItem>) => {
      favorite.path = args[0]?.path;
      return actual.useFavoriteMenuItem(...args);
    },
  };
});

vi.mock('@/features/Workspace/WorkspaceLink', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: permission.allowed }),
}));

const project = {
  avatar: 'https://app.lobehub.com/f/file_pgJKqTkKrHJJ',
  id: 'proj_1',
  name: 'LobeHub',
  slug: 'lobehub',
  userId: 'user_1',
} as ProjectListItem;

describe('ProjectItem', () => {
  beforeEach(() => {
    permission.allowed = true;
  });

  it('renders a project whose avatar is an image URL', () => {
    const { container } = render(<ProjectItem project={project} />);

    expect(screen.getByText('LobeHub')).toBeInTheDocument();
    // Browsers throw when the URL is used as a tag name; happy-dom tolerates it,
    // so assert the avatar is rendered as an image instead of an element.
    expect(container.querySelector('img')).toHaveAttribute('src', project.avatar);
    for (const el of container.querySelectorAll('*')) {
      expect(el.tagName).toMatch(/^[a-z][\w-]*$/i);
    }
  });

  // `project.userId` is never the current user here: any member who can edit
  // manages a project, whoever created it.
  it('shows the actions menu for a project another member created', () => {
    const { container } = render(<ProjectItem project={project} />);

    expect(container.querySelector('.nav-item-actions')).not.toBeNull();
  });

  it('keeps the actions menu for members without edit permission, who can still favorite', () => {
    permission.allowed = false;
    const { container } = render(<ProjectItem project={project} />);

    expect(container.querySelector('.nav-item-actions')).not.toBeNull();
  });

  // A slug can be renamed from Project Settings, so the favorite keeps the id link.
  it('favorites the project under its id, not its renameable slug', () => {
    render(<ProjectItem project={project} />);

    expect(favorite.path).toBe('/project/proj_1');
  });
});
