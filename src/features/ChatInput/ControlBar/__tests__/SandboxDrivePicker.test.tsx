import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import SandboxDrivePicker from '../SandboxDrivePicker';
import type { SandboxSelection } from '../useSandboxPlacement';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobechat/business-const', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ENABLE_BUSINESS_FEATURES: true,
}));

// Every menu, open: what each layout offers is the question, not how it opens.
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Popover: ({ children, content }: { children: ReactNode; content: ReactNode }) => (
    <div>
      {children}
      {content}
    </div>
  ),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => undefined,
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));
vi.mock('@/features/EnvironmentManager/CreateEnvironmentModal', () => ({
  openCreateEnvironmentModal: vi.fn(),
}));
vi.mock('@/features/WorkingDirectory', () => ({ openSandboxDirectoryModal: vi.fn() }));
vi.mock('@/components/RepositoryAvatar', () => ({ default: () => null }));
vi.mock('@/services/environment', () => ({
  environmentService: { listEnvironments: vi.fn(async () => ({ environments: [] })) },
}));
vi.mock('@/services/projectFile', () => ({ refreshProjectFiles: vi.fn() }));
vi.mock('@/services/sandboxStorage', () => ({
  sandboxStorageService: {
    getInstance: vi.fn(),
    resolveSessionPlacement: vi.fn(async () => ({})),
  },
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: object) => unknown) => selector({}),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: { currentAgentVisibility: () => 'private' },
}));
vi.mock('../SandboxDriveMenu', () => ({
  default: ({ selectedPath }: { selectedPath?: string }) => (
    <div data-testid="drive-folders">{selectedPath}</div>
  ),
}));
vi.mock('../SandboxRepositoryMenu', () => ({
  default: ({ none }: { none?: { active: boolean } }) =>
    none ? <div data-testid="repository-menu">{none.active ? 'none-active' : 'none'}</div> : null,
}));

const renderPicker = (value: SandboxSelection, props: { modeInEnvironmentMenu?: boolean } = {}) =>
  render(<SandboxDrivePicker entitled value={value} onChange={vi.fn()} {...props} />);

// T-14161: the sandbox kind is picked in the execution-environment menu, so
// this menu only asks what is left for that kind.
describe('SandboxDrivePicker', () => {
  // A repository belongs to the temporary sandbox; the persistent one only
  // asks which folder of the drive to keep.
  it('lists only the drive folders on the persistent sandbox', () => {
    renderPicker({ workingDirectory: 'notes' });

    expect(screen.getByTestId('drive-folders').textContent).toBe('notes');
    expect(screen.queryByText('sandboxStorage.ephemeral', { selector: 'div *' })).toBeNull();
    expect(screen.queryByTestId('sandbox-drive-row')).toBeNull();
    expect(screen.queryByTestId('sandbox-repository-row')).toBeNull();
    expect(screen.queryByTestId('repository-menu')).toBeNull();
  });

  // The temporary sandbox's folder is always a fresh empty one: nothing to
  // pick there, only whether a repository is cloned into it.
  it('asks only for a repository on the temporary sandbox', () => {
    renderPicker({});

    expect(screen.queryByTestId('drive-folders')).toBeNull();
    expect(screen.queryByTestId('sandbox-drive-row')).toBeNull();
    expect(screen.queryByTestId('sandbox-repository-row')).toBeNull();
    expect(screen.queryByText('sandboxStorage.ephemeral')).toBeNull();
    expect(screen.getByTestId('repository-menu').textContent).toBe('none-active');
    expect(screen.getByText('sandboxEnvironment.none')).toBeInTheDocument();
  });

  it('marks the picked repository rather than none on the temporary sandbox', () => {
    renderPicker({ environmentId: 'env-1' });

    expect(screen.getByTestId('repository-menu').textContent).toBe('none');
  });

  // A member of a workspace agent whose author fixed the target sees the
  // execution environment read-only; the placement is still theirs to change.
  it('keeps temporary and drive side by side when the environment menu is locked', () => {
    renderPicker({ workingDirectory: 'notes' }, { modeInEnvironmentMenu: false });

    expect(screen.getByTestId('sandbox-drive-row')).toBeInTheDocument();
    expect(screen.getByTestId('sandbox-repository-row')).toBeInTheDocument();
    expect(screen.getByText('sandboxStorage.ephemeral')).toBeInTheDocument();
  });
});
