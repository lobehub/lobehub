/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EditTaskParams, RunTaskParams, SetTaskVerifyParams } from '../../types';
import EditTaskRender from './EditTask';
import RunTaskRender from './RunTask';
import SetTaskVerifyRender from './SetTaskVerify';

interface AgentDisplayMeta {
  avatar?: string;
  title?: string;
}

const mocks = vi.hoisted(() => ({
  agentMetaById: {} as Record<string, AgentDisplayMeta | undefined>,
}));

// Translate to the last segment of the key so assertions stay readable.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key.split('.').at(-1) || key }),
}));

// Headless stubs for @lobehub/ui so we exercise our own markup, not the design
// system internals (which would need a theme provider in jsdom).
vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ title }: { title?: string }) => <button data-testid="action-icon" title={title} />,
  Block: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <div data-testid="block" onClick={onClick}>
      {children}
    </div>
  ),
  Icon: () => <span data-testid="icon" />,
  Markdown: ({ children }: { children?: ReactNode }) => (
    <div data-testid="markdown">{children}</div>
  ),
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/features/AgentTasks/features/AssigneeAvatar', () => ({
  default: ({ agentId }: { agentId?: string | null }) => (
    <span data-agent-id={agentId || ''} data-testid="assignee-avatar" />
  ),
}));

vi.mock('@/features/AgentTasks/features/TaskPriorityTag', () => ({
  default: ({ priority }: { priority?: number | null }) => (
    <span data-priority={String(priority)} data-testid="priority-tag" />
  ),
}));

vi.mock('@/features/AgentTasks/shared/useAgentDisplayMeta', () => ({
  useAgentDisplayMeta: (id: string) => mocks.agentMetaById[id],
}));

// The shared card reads the chat portal store to wire open/close detail.
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: unknown) => unknown) =>
    selector({ closeTaskDetail: vi.fn(), openTaskDetail: vi.fn() }),
}));

vi.mock('@/store/chat/selectors', () => ({
  chatPortalSelectors: {
    showTaskDetail: () => false,
    taskDetailId: () => undefined,
  },
}));

const renderProps = {
  content: '',
  messageId: 'message-test',
};

describe('EditTaskRender', () => {
  beforeEach(() => {
    mocks.agentMetaById = {};
  });
  afterEach(() => cleanup());

  const renderEdit = (args: Partial<EditTaskParams>) =>
    render(
      <EditTaskRender {...renderProps} args={{ identifier: 'T-1', ...args } as EditTaskParams} />,
    );

  it('renders the identifier and edit title', () => {
    renderEdit({ name: 'Renamed task' });

    expect(screen.getByText('T-1')).toBeTruthy();
    expect(screen.getByText('editTask')).toBeTruthy();
    expect(screen.getByText('Renamed task')).toBeTruthy();
  });

  it('resolves the assignee agent name', () => {
    mocks.agentMetaById.agt_worker = { title: 'Worker Agent' };
    renderEdit({ assigneeAgentId: 'agt_worker' });

    expect(screen.getByTestId('assignee-avatar').dataset.agentId).toBe('agt_worker');
    expect(screen.getByText('Worker Agent')).toBeTruthy();
  });

  it('shows the unassign label when the assignee is cleared', () => {
    renderEdit({ assigneeAgentId: null });

    expect(screen.getByText('unassign')).toBeTruthy();
    expect(screen.queryByTestId('assignee-avatar')).toBeNull();
  });

  it('renders the instruction preview as markdown', () => {
    renderEdit({ instruction: '# Do the thing' });

    expect(screen.getByTestId('markdown').textContent).toContain('# Do the thing');
  });

  it('renders dependency changes', () => {
    renderEdit({ addDependencies: ['T-2'], removeDependencies: ['T-3'] });

    expect(screen.getByText('T-2')).toBeTruthy();
    expect(screen.getByText('T-3')).toBeTruthy();
  });

  it('renders only the header when there are no field changes', () => {
    renderEdit({});

    expect(screen.getByText('T-1')).toBeTruthy();
    expect(screen.queryByTestId('markdown')).toBeNull();
    expect(screen.queryByTestId('assignee-avatar')).toBeNull();
  });
});

describe('SetTaskVerifyRender', () => {
  beforeEach(() => {
    mocks.agentMetaById = {};
  });
  afterEach(() => cleanup());

  const renderVerify = (args: Partial<SetTaskVerifyParams>) =>
    render(
      <SetTaskVerifyRender
        {...renderProps}
        args={{ identifier: 'T-1', ...args } as SetTaskVerifyParams}
      />,
    );

  it('shows the gate-on label and full requirement text', () => {
    renderVerify({ enabled: true, requirement: 'Ship a complete report' });

    expect(screen.getByText('on')).toBeTruthy();
    expect(screen.getByText('Ship a complete report')).toBeTruthy();
  });

  it('shows the gate-off label when disabled', () => {
    renderVerify({ enabled: false });

    expect(screen.getByText('off')).toBeTruthy();
  });

  it('renders the requirement as markdown only (no extra fields)', () => {
    renderVerify({
      enabled: true,
      maxIterations: 3,
      requirement: '## Acceptance',
      verifierAgentId: 'agt_verifier',
    });

    // Body is just the requirement markdown — verifier / iterations are not shown.
    expect(screen.getByTestId('markdown').textContent).toContain('## Acceptance');
    expect(screen.queryByTestId('assignee-avatar')).toBeNull();
    expect(screen.queryByText('3')).toBeNull();
  });
});

describe('RunTaskRender', () => {
  afterEach(() => cleanup());

  const renderRun = (
    args: Partial<RunTaskParams>,
    pluginState?: { identifier: string; success: boolean; topicId?: string },
  ) =>
    render(
      <RunTaskRender
        {...renderProps}
        args={{ identifier: 'T-1', ...args } as RunTaskParams}
        pluginState={pluginState}
      />,
    );

  it('renders the run title and identifier', () => {
    renderRun({});

    expect(screen.getByText('runTask')).toBeTruthy();
    expect(screen.getByText('T-1')).toBeTruthy();
  });

  it('renders the prompt and resolved topic id', () => {
    renderRun(
      { prompt: 'Focus on the MVP' },
      { identifier: 'T-1', success: true, topicId: 'tpc_123' },
    );

    expect(screen.getByText('Focus on the MVP')).toBeTruthy();
    expect(screen.getByText('tpc_123')).toBeTruthy();
  });
});
