import { render, screen } from '@testing-library/react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import EnvironmentDetailPanel from './EnvironmentDetailPanel';
import type { SandboxEnvironment } from './useEnvironmentData';

dayjs.extend(relativeTime);

const mocks = vi.hoisted(() => ({
  canEdit: true,
  instances: [] as { environmentId: string; id: string }[],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('./InstanceSection', () => ({
  default: ({ single }: { single?: boolean }) => (
    <div data-testid={single ? 'copy-single' : 'copy-list'} />
  ),
}));
vi.mock('./SessionHistorySection', () => ({
  default: () => <div data-testid="session-history" />,
}));
vi.mock('./EnvironmentForm', () => ({ default: () => <div data-testid="form" /> }));
vi.mock('./useCanEditEnvironment', () => ({
  useCanEditEnvironment: () => () => mocks.canEdit,
}));
vi.mock('./useEnvironmentData', () => ({
  useEnvironmentActions: () => ({ updateEnvironment: vi.fn() }),
  useInstances: () => ({ data: { instances: mocks.instances } }),
}));

const environment = (configuration: Record<string, unknown>): SandboxEnvironment =>
  ({
    configuration,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    creator: { avatar: null, fullName: 'Owner', username: 'owner' },
    description: null,
    id: 'env-1',
    name: 'repo',
    visibility: 'private',
    workspaceId: null,
  }) as unknown as SandboxEnvironment;

const codeEnvironment = environment({
  kind: 'code',
  sources: [{ kind: 'git', url: 'https://github.com/o/repo' }],
});
const filesEnvironment = environment({ kind: 'files' });

const copies = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ environmentId: 'env-1', id: `inst-${index}` }));

const tab = (name: string) => screen.queryByRole('tab', { name: new RegExp(name) });

describe('EnvironmentDetailPanel', () => {
  beforeEach(() => {
    mocks.canEdit = true;
  });

  it('has no Copies tab for an environment with one copy, and shows it in Overview', () => {
    mocks.instances = copies(1);
    render(<EnvironmentDetailPanel environment={codeEnvironment} onClose={vi.fn()} />);

    expect(tab('environments.instances.title')).toBeNull();
    expect(tab('environments.sessions.title')).toBeNull();
    expect(tab('environments.detail.tabs.overview')).not.toBeNull();
    // Build state and files (the copy) and run history, on one page.
    expect(screen.getByTestId('copy-single')).toBeTruthy();
    expect(screen.getByTestId('session-history')).toBeTruthy();
  });

  it('lists the copies once there is more than one', () => {
    mocks.instances = copies(2);
    render(<EnvironmentDetailPanel environment={codeEnvironment} onClose={vi.fn()} />);

    expect(tab('environments.instances.title')).not.toBeNull();
    expect(tab('environments.sessions.title')).not.toBeNull();
    expect(tab('environments.detail.tabs.overview')).toBeNull();
    expect(screen.getByTestId('copy-list')).toBeTruthy();
  });

  it('still shows a files environment its copy, so its files are reachable', () => {
    mocks.instances = copies(1);
    render(<EnvironmentDetailPanel environment={filesEnvironment} onClose={vi.fn()} />);

    expect(screen.getByTestId('copy-single')).toBeTruthy();
    expect(tab('environments.form.env')).toBeNull();
  });

  it('gives a colleague the Overview without the editing tabs', () => {
    mocks.canEdit = false;
    mocks.instances = copies(1);
    render(<EnvironmentDetailPanel environment={codeEnvironment} onClose={vi.fn()} />);

    expect(tab('environments.detail.tabs.overview')).not.toBeNull();
    expect(tab('environments.detail.tabs.settings')).toBeNull();
  });
});
