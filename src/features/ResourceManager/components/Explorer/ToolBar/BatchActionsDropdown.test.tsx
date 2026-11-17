import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import BatchActionsDropdown from './BatchActionsDropdown';

const permission = vi.hoisted(() => ({ allowed: true, reason: 'No permission' }));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => permission,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => undefined,
}));

vi.mock('@/features/ResourceManager/components/KnowledgeBaseListProvider', () => ({
  useKnowledgeBaseListContext: () => [],
}));

vi.mock('@/features/ResourceManager/store', () => ({
  useResourceManagerStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      libraryId: undefined,
      listVisibility: undefined,
      resolveSelectedResourceIds: vi.fn(),
      selectAllState: 'none',
    }),
}));

vi.mock('@/store/library', () => ({
  useKnowledgeBaseStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ addFilesToKnowledgeBase: vi.fn() }),
}));

const getTrigger = () => screen.getByTitle('Batch actions');

describe('BatchActionsDropdown', () => {
  beforeEach(() => {
    permission.allowed = true;
  });

  it('opens the batch actions menu when the trigger is clicked', async () => {
    render(<BatchActionsDropdown selectCount={0} onActionClick={vi.fn()} />);

    fireEvent.click(getTrigger());

    expect(await screen.findByText('FileManager.actions.batchChunking')).toBeInTheDocument();
  });

  it('renders a disabled trigger without a menu when editing is not allowed', () => {
    permission.allowed = false;
    render(<BatchActionsDropdown selectCount={0} onActionClick={vi.fn()} />);

    const trigger = getTrigger();
    expect(trigger).toBeDisabled();

    fireEvent.click(trigger);
    expect(screen.queryByText('FileManager.actions.batchChunking')).not.toBeInTheDocument();
  });
});
