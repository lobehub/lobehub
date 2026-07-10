import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import EmptyPlaceholder from './EmptyPlaceholder';

const mockOpen = vi.fn();
const mockPushDockFileList = vi.fn();
let canCreate = true;
let libraryId: string | undefined;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/features/LibraryModal', () => ({
  useCreateNewModal: () => ({ open: mockOpen }),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: canCreate, reason: '' }),
}));

vi.mock('@/routes/(main)/resource/features/hooks/useCurrentFolderId', () => ({
  useCurrentFolderId: () => undefined,
}));

vi.mock('@/routes/(main)/resource/features/store', () => ({
  useResourceManagerStore: (selector: (state: { libraryId?: string }) => unknown) =>
    selector({ libraryId }),
}));

vi.mock('@/store/file', () => ({
  useFileStore: (selector: (state: { pushDockFileList: typeof mockPushDockFileList }) => unknown) =>
    selector({ pushDockFileList: mockPushDockFileList }),
}));

describe('EmptyPlaceholder', () => {
  beforeEach(() => {
    canCreate = true;
    libraryId = undefined;
    vi.clearAllMocks();
  });

  it('should render create actions when the user can create resources', () => {
    render(<EmptyPlaceholder />);

    expect(screen.getByText('FileManager.emptyStatus.actions.knowledgeBase')).toBeInTheDocument();
    expect(screen.getByText('FileManager.emptyStatus.actions.file')).toBeInTheDocument();
    expect(screen.getByText('FileManager.emptyStatus.actions.folder')).toBeInTheDocument();
  });

  it('should hide create actions when the user cannot create resources', () => {
    canCreate = false;

    render(<EmptyPlaceholder />);

    expect(
      screen.queryByText('FileManager.emptyStatus.actions.knowledgeBase'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('FileManager.emptyStatus.actions.file')).not.toBeInTheDocument();
    expect(screen.queryByText('FileManager.emptyStatus.actions.folder')).not.toBeInTheDocument();
  });
});
