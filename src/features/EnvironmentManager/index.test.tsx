import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import EnvironmentManager from './index';
import type { CreatedEnvironment } from './useEnvironmentData';

const mocks = vi.hoisted(() => ({
  buildInstance: vi.fn(),
  openCreateEnvironmentModal: vi.fn(),
  openCreateInstanceModal: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/components/AsyncBoundary', () => ({
  default: ({ empty, isEmpty }: { empty: React.ReactNode; isEmpty: boolean }) =>
    isEmpty ? empty : null,
}));
vi.mock('./CreateEnvironmentModal', () => ({
  openCreateEnvironmentModal: mocks.openCreateEnvironmentModal,
}));
vi.mock('./CreateInstanceModal', () => ({
  openCreateInstanceModal: mocks.openCreateInstanceModal,
}));
vi.mock('./EnvironmentDetailPanel', () => ({ default: () => null }));
vi.mock('./WorkspaceUsageMeter', () => ({ default: () => null }));
vi.mock('./useEnvironmentData', () => ({
  useEnvironmentActions: () => ({ buildInstance: mocks.buildInstance }),
  useEnvironments: () => ({
    data: { environments: [] },
    error: undefined,
    isValidating: false,
    mutate: vi.fn(),
  }),
  useInstances: () => ({ data: { instances: [] }, mutate: vi.fn() }),
  useWorkspaceUsage: () => ({ refresh: vi.fn() }),
}));

const created = (kind: 'code' | 'files') =>
  ({
    configuration: { kind },
    defaultInstance: { id: `default-${kind}` },
    id: `env-${kind}`,
    name: 'repo',
  }) as unknown as CreatedEnvironment;

/** Open the create dialog and hand back what it was told to do on success. */
const createThrough = () => {
  render(<EnvironmentManager />);
  fireEvent.click(screen.getAllByRole('button', { name: /environments\.create/ })[0]);

  return mocks.openCreateEnvironmentModal.mock.calls.at(-1)![1] as (
    environment: CreatedEnvironment,
  ) => void;
};

describe('EnvironmentManager — after creating an environment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens no instance dialog and starts the default copy of a code environment', () => {
    const onCreated = createThrough();

    onCreated(created('code'));

    expect(mocks.openCreateInstanceModal).not.toHaveBeenCalled();
    expect(mocks.buildInstance).toHaveBeenCalledWith('default-code');
  });

  it('settles a files environment the same way, with no dialog either', () => {
    const onCreated = createThrough();

    onCreated(created('files'));

    expect(mocks.openCreateInstanceModal).not.toHaveBeenCalled();
    // The server answers a files copy's build with "ready" and no sandbox.
    expect(mocks.buildInstance).toHaveBeenCalledWith('default-files');
  });
});
