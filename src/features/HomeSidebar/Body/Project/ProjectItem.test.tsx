import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ProjectListItem } from '@/store/project';

import ProjectItem from './ProjectItem';

vi.mock('@/features/Workspace/WorkspaceLink', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const project = {
  avatar: 'https://app.lobehub.com/f/file_pgJKqTkKrHJJ',
  id: 'proj_1',
  name: 'LobeHub',
  slug: 'lobehub',
  userId: 'user_1',
} as ProjectListItem;

describe('ProjectItem', () => {
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
});
