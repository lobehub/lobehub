/**
 * @vitest-environment happy-dom
 */
import { render, screen, within } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import KnowledgeBaseItem from './index';

const knowledgeBaseState = vi.hoisted(() => ({
  knowledgeBaseLoadingIds: [] as string[],
  knowledgeBaseRenamingId: null as string | null,
  updateKnowledgeBase: vi.fn(),
}));

vi.mock('@/components/LibIcon', () => ({
  default: () => <span data-testid="repo-icon" />,
}));

vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({ actions, title }: { actions?: ReactNode; title: ReactNode }) => (
    <div data-testid="nav-item">
      <span data-testid="nav-title">{title}</span>
      {actions}
    </div>
  ),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));

vi.mock('@/features/NavPanel/OverlayContainer', () => ({
  useOverlayPopoverPortalProps: () => undefined,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true }),
}));

vi.mock('@/routes/(main)/resource/features/store', () => ({
  useResourceManagerStore: (selector: (state: { setLibraryId: () => void }) => unknown) =>
    selector({ setLibraryId: vi.fn() }),
}));

vi.mock('@/store/library', () => ({
  useKnowledgeBaseStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(knowledgeBaseState),
}));

vi.mock('./Actions', () => ({
  default: () => <div data-testid="actions" />,
}));

vi.mock('./useDropdownMenu', () => ({
  useDropdownMenu: () => [],
}));

describe('KnowledgeBaseItem', () => {
  beforeEach(() => {
    knowledgeBaseState.knowledgeBaseLoadingIds = [];
    knowledgeBaseState.knowledgeBaseRenamingId = null;
    knowledgeBaseState.updateKnowledgeBase.mockReset();
  });

  it('keeps the visible row and rename anchor inside one list child', () => {
    const { container } = render(<KnowledgeBaseItem id="kb-1" name="My Library" />);

    expect(container.childElementCount).toBe(1);
    expect(container.firstElementChild).toContainElement(screen.getByTestId('nav-item'));
  });

  it('renders the rename input inside the row title while editing', () => {
    knowledgeBaseState.knowledgeBaseRenamingId = 'kb-1';

    render(<KnowledgeBaseItem id="kb-1" name="My Library" />);

    expect(within(screen.getByTestId('nav-title')).getByRole('textbox')).toHaveValue('My Library');
  });
});
