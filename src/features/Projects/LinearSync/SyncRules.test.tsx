import { render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SyncRules from './SyncRules';

const linearServiceMocks = vi.hoisted(() => ({
  deleteSyncRule: vi.fn(),
  listSyncRules: vi.fn(),
  startRuleSync: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/services/linear', () => ({ linearService: linearServiceMocks }));

const rule = {
  connectionId: 'conn-1',
  id: 'rule-1',
  lastRunAt: null,
  linearProjectName: 'Workspace',
  stateTypes: ['backlog'],
  teamName: 'Engineering',
};
const connections = [{ id: 'conn-1', organizationName: 'LobeHub' }] as any;

const renderRules = (jobs: any[]) =>
  render(
    <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
      <SyncRules
        connections={connections}
        jobs={jobs}
        projectId={'project-1'}
        onJobStarted={vi.fn()}
      />
    </SWRConfig>,
  );

describe('SyncRules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    linearServiceMocks.listSyncRules.mockResolvedValue([rule]);
  });

  it('spins only the main half and disables the options half while a rule is running', async () => {
    const { container } = renderRules([{ id: 'job-1', ruleId: 'rule-1', status: 'processing' }]);
    const main = (await screen.findByText('linear.sync.rules.running')).closest('button')!;
    const menu = container.querySelector<HTMLButtonElement>('.lobe-split-button__menu')!;

    expect(main).toHaveAttribute('aria-busy', 'true');
    expect(menu).not.toHaveAttribute('aria-busy');
    expect(menu).toBeDisabled();
    expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(1);
  });

  it('keeps both halves idle and enabled when the rule is not running', async () => {
    const { container } = renderRules([]);
    const main = (await screen.findByText('linear.sync.rules.run')).closest('button')!;
    const menu = container.querySelector<HTMLButtonElement>('.lobe-split-button__menu')!;

    expect(main).not.toHaveAttribute('aria-busy');
    expect(main).toBeEnabled();
    expect(menu).toBeEnabled();
  });
});
