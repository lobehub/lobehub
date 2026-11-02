import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DirectoryBrowser } from './DirectoryBrowser';
import type { DirectoryListing, DirectorySource } from './directorySource';

const sourceWith = (listing: Partial<DirectoryListing>): DirectorySource => ({
  createFolder: vi.fn(),
  editablePath: false,
  rootLabel: 'Drive',
  useListing: () => ({
    directory: { parentPath: null, path: '' },
    entries: [{ name: 'held', path: 'held' }],
    hasMore: false,
    isLoading: false,
    isLoadingMore: false,
    isRefreshing: false,
    loadMore: vi.fn(),
    refresh: vi.fn(),
    retry: vi.fn(),
    ...listing,
  }),
});

const renderBrowser = (source: DirectorySource) =>
  render(
    <DirectoryBrowser loading={false} source={source} onCancel={vi.fn()} onSelect={vi.fn()} />,
  );

describe('DirectoryBrowser', () => {
  it('should neither list nor allow using a folder whose listing failed', () => {
    // Folders came back but what classifies them did not: an environment
    // directory would read as a plain folder to browse into and use.
    renderBrowser(sourceWith({ error: new Error('instances unavailable') }));

    expect(screen.queryByText('held')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('workingDirectory.useFolder').closest('button')).toBeDisabled();
  });

  it('should list the folders and allow using the folder once it loads', () => {
    renderBrowser(sourceWith({}));

    expect(screen.getByText('held')).toBeInTheDocument();
    expect(screen.getByText('workingDirectory.useFolder').closest('button')).not.toBeDisabled();
  });
});
