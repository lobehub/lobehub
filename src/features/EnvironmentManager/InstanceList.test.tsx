import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import InstanceList from './InstanceList';
import type { SandboxInstance } from './useEnvironmentData';

const mocks = vi.hoisted(() => ({
  openCopyInstanceModal: vi.fn(),
  refreshRows: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
// The real ActionIcon only puts its title in a tooltip; a plain button
// labelled with it is what these tests need to find each entry.
vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ActionIcon: ({
    disabled,
    onClick,
    title,
  }: {
    disabled?: boolean;
    onClick?: () => void;
    title?: string;
  }) => <button aria-label={title} disabled={disabled} type="button" onClick={onClick} />,
  toast: { error: mocks.toastError, success: vi.fn() },
}));
vi.mock('./CreateInstanceModal', () => ({
  openCopyInstanceModal: mocks.openCopyInstanceModal,
  openCreateInstanceModal: vi.fn(),
  openEditInstanceModal: vi.fn(),
}));
vi.mock('./InstanceFileBrowser', () => ({ openInstanceFileBrowser: vi.fn() }));
vi.mock('./useEnvironmentData', () => ({
  useBuildStarting: () => false,
  useInstanceBuild: () => ({ error: undefined, log: '', retry: vi.fn(), state: undefined }),
  useInstances: () => ({ refreshRows: mocks.refreshRows }),
}));

const instance = (overrides: Partial<SandboxInstance> = {}): SandboxInstance => ({
  buildError: null,
  buildId: null,
  buildable: true,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  environmentId: 'env-1',
  id: 'inst-1',
  inUse: false,
  inUseByThisTopic: false,
  isDefault: true,
  name: 'repo',
  snapshot: null,
  status: 'ready',
  workingDirectory: 'repo',
  ...overrides,
});

const renderList = (
  instances: SandboxInstance[],
  { editable = true, occupancyUnavailable = false, single = false } = {},
) =>
  render(
    <InstanceList
      showBuild
      editable={editable}
      environmentId={'env-1'}
      instances={instances}
      occupancyUnavailable={occupancyUnavailable}
      single={single}
      onBuild={vi.fn()}
      onRemove={vi.fn()}
      onStop={vi.fn()}
    />,
  );

const action = (name: string) => screen.queryByRole('button', { name });

describe('InstanceList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('delete', () => {
    it('offers no delete on the default copy', () => {
      renderList([instance({ isDefault: true })]);

      expect(action('environments.instances.remove')).toBeNull();
    });

    it('keeps delete on a copy beside the default', () => {
      renderList([
        instance({ id: 'inst-1', isDefault: true }),
        instance({ id: 'inst-2', isDefault: false, name: 'repo-2', workingDirectory: 'repo-2' }),
      ]);

      expect(screen.getAllByRole('button', { name: 'environments.instances.remove' })).toHaveLength(
        1,
      );
    });
  });

  describe('copy', () => {
    it('greys out the copy entry, with the reason, while a run holds the source', () => {
      renderList([instance({ inUse: true })]);

      const copy = action('environments.instances.copyInUse');
      expect(copy).not.toBeNull();
      expect(copy).toHaveAttribute('disabled');
      expect(action('environments.instances.copy')).toBeNull();
    });

    it('greys out the copy entry when occupancy could not be read', () => {
      renderList([instance()], { occupancyUnavailable: true });

      expect(action('environments.instances.copyOccupancyUnknown')).toHaveAttribute('disabled');
    });

    it('hides the copy entry from anyone but the environment creator', () => {
      renderList([instance()], { editable: false });

      expect(action('environments.instances.copy')).toBeNull();
      expect(action('environments.instances.copyInUse')).toBeNull();
    });

    it('checks occupancy again before opening the copy dialog for an idle source', async () => {
      mocks.refreshRows.mockResolvedValue({
        instances: [instance()],
        occupancyUnavailable: false,
      });
      renderList([instance()]);

      fireEvent.click(action('environments.instances.copy')!);

      await waitFor(() => expect(mocks.openCopyInstanceModal).toHaveBeenCalledTimes(1));
      expect(mocks.refreshRows).toHaveBeenCalledTimes(1);
      expect(mocks.openCopyInstanceModal.mock.calls[0][0]).toMatchObject({ id: 'inst-1' });
    });

    it('refuses to open the dialog when the fresh read finds the source taken', async () => {
      mocks.refreshRows.mockResolvedValue({
        instances: [instance({ inUse: true })],
        occupancyUnavailable: false,
      });
      renderList([instance()]);

      fireEvent.click(action('environments.instances.copy')!);

      await waitFor(() =>
        expect(mocks.toastError).toHaveBeenCalledWith('environments.instances.copyInUse'),
      );
      expect(mocks.openCopyInstanceModal).not.toHaveBeenCalled();
    });
  });

  it('names the file browser outright on the only copy', () => {
    renderList([instance()], { single: true });

    expect(screen.getByRole('button', { name: /environments\.files\.browse/ })).toHaveTextContent(
      'environments.files.browse',
    );
  });
});
