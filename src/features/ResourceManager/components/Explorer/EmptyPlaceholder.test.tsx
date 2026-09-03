import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FilesTabs, ResourceSourceFilter } from '@/types/files';

import EmptyPlaceholder from './EmptyPlaceholder';

const mockOpen = vi.fn();
const mockPushDockFileList = vi.fn();
const mockSetSourceFilter = vi.fn();
let canCreate = true;
let category: FilesTabs = FilesTabs.All;
let libraryId: string | undefined;
let sourceFilter: ResourceSourceFilter | undefined;

vi.mock('@/features/LibraryModal', () => ({
  useCreateNewModal: () => ({ open: mockOpen }),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: canCreate, reason: '' }),
}));

vi.mock('@/features/ResourceManager/hooks/useCurrentFolderId', () => ({
  useCurrentFolderId: () => undefined,
}));

vi.mock('@/features/ResourceManager/store', () => ({
  useResourceManagerStore: (selector: (state: any) => unknown) =>
    selector({ category, libraryId, setSourceFilter: mockSetSourceFilter, sourceFilter }),
}));

vi.mock('@/store/file', () => ({
  useFileStore: (selector: (state: { pushDockFileList: typeof mockPushDockFileList }) => unknown) =>
    selector({ pushDockFileList: mockPushDockFileList }),
}));

describe('EmptyPlaceholder', () => {
  beforeEach(() => {
    canCreate = true;
    category = FilesTabs.All;
    libraryId = undefined;
    sourceFilter = undefined;
    vi.clearAllMocks();
  });

  it('should blame the source filter instead of prompting onboarding when it narrows', async () => {
    // Images defaults to AI-generated, so a library of uploads lands here.
    category = FilesTabs.Images;

    render(<EmptyPlaceholder />);

    expect(screen.getByText('FileManager.emptyStatus.filteredTitle')).toBeInTheDocument();
    expect(
      screen.queryByText('FileManager.emptyStatus.actions.knowledgeBase'),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('FileManager.emptyStatus.actions.showAllSources'));

    expect(mockSetSourceFilter).toHaveBeenCalledWith(ResourceSourceFilter.All);
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
