import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sandboxStorageService } from '@/services/sandboxStorage';

import { useSandboxDirectorySource } from './useSandboxDirectorySource';

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => 'ws1',
}));

vi.mock('@/services/sandboxStorage', () => ({
  sandboxStorageService: { createDirectory: vi.fn(), listFiles: vi.fn() },
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>{children}</SWRConfig>
);

const renderSource = (drive: 'personal' | 'public' = 'personal') =>
  renderHook(() => useSandboxDirectorySource({ drive, isWorkspace: true }), { wrapper });

const renderListing = (path?: string) =>
  renderHook(
    () => useSandboxDirectorySource({ drive: 'personal', isWorkspace: true }).useListing(path),
    { wrapper },
  );

describe('useSandboxDirectorySource', () => {
  beforeEach(() => {
    vi.mocked(sandboxStorageService.listFiles)
      .mockReset()
      .mockResolvedValue({
        entries: [
          { isDirectory: true, isGitRepository: true, name: 'app', path: 'app' },
          { isDirectory: true, name: 'notes', path: 'notes' },
          { isDirectory: false, name: 'readme.md', path: 'readme.md' },
        ],
      } as any);
    vi.mocked(sandboxStorageService.createDirectory)
      .mockReset()
      .mockResolvedValue({} as any);
  });

  it('lists folders only, and marks the ones that are git repositories', async () => {
    const { result } = renderListing();

    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    const [app, notes] = result.current.entries;
    expect(app).toMatchObject({ name: 'app', path: 'app' });
    expect(app.icon).toBeDefined();
    expect(app.tags).toBeDefined();
    expect(notes).toMatchObject({ name: 'notes', path: 'notes' });
    expect(notes.icon).toBeUndefined();
    expect(notes.tags).toBeUndefined();
  });

  it('treats a folder a code environment initialized as an ordinary folder', async () => {
    // No environment directory, no in-use or building state: every folder
    // opens into its contents and carries the same rename/delete menu.
    const { result } = renderListing();

    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    for (const entry of result.current.entries) {
      expect(entry.actions).toBeDefined();
      expect(entry.disabled).toBeFalsy();
      expect(entry.description).toBeUndefined();
    }
  });

  it('creates a plain folder beside the ones listed, whatever is browsed', async () => {
    const { result } = renderSource();

    await expect(result.current.createFolder('projects', 'api')).resolves.toEqual({
      path: 'projects/api',
    });
    expect(sandboxStorageService.createDirectory).toHaveBeenCalledWith({
      drive: 'personal',
      path: 'projects/api',
    });
  });

  it('is laid out like the device picker: a path field, not a breadcrumb', () => {
    const { result } = renderSource();

    expect(result.current).not.toHaveProperty('rootLabel');
    expect(result.current.editablePath).toBe(false);
    expect(result.current.displayPath?.('reports')).toBe('/reports');
  });

  it("refuses the public drive's root, and only that", () => {
    const { result } = renderSource('public');

    expect(result.current.selectBlockedReason?.('')).toBe('workingDirectory.drive.rootNotAllowed');
    expect(result.current.selectBlockedReason?.('team')).toBeUndefined();
  });

  it('fails a listing whose folders cannot be read, and retries it', async () => {
    const failure = new Error('drive unavailable');
    vi.mocked(sandboxStorageService.listFiles).mockRejectedValueOnce(failure);

    const { result } = renderListing();
    await waitFor(() => expect(result.current.error).toBe(failure));
    expect(result.current.entries).toEqual([]);

    result.current.retry();

    await waitFor(() => expect(result.current.entries).toHaveLength(2));
  });
});
