import type { TaskDetailData } from '@lobechat/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentStoreState } from '@/store/agent/initialState';
import { initialState as initialAgentState } from '@/store/agent/initialState';
import type { TaskStoreState } from '@/store/task/initialState';
import { initialState as initialTaskState } from '@/store/task/initialState';

import TaskModelConfig from './TaskModelConfig';

const fixture = vi.hoisted(() => ({
  agent: {} as AgentStoreState,
  task: {} as TaskStoreState,
  updateTaskModelConfig: vi.fn(),
}));

vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/store/agent', () => ({
  useAgentStore: <T,>(selector: (state: AgentStoreState) => T) => selector(fixture.agent),
}));
vi.mock('@/store/task', () => ({
  useTaskStore: <T,>(
    selector: (
      state: TaskStoreState & { updateTaskModelConfig: typeof fixture.updateTaskModelConfig },
    ) => T,
  ) => selector({ ...fixture.task, updateTaskModelConfig: fixture.updateTaskModelConfig }),
}));
vi.mock('@/features/ModelSelect', () => ({
  default: ({ value }: { value: { model: string; provider: string } }) => (
    <button>
      {value.provider} / {value.model}
    </button>
  ),
}));

describe('TaskModelConfig', () => {
  beforeEach(() => {
    fixture.agent = {
      ...initialAgentState,
      activeAgentId: 'unrelated',
      agentMap: {
        assignee: {
          agencyConfig: {
            heterogeneousProvider: {
              effort: 'high',
              model: 'gpt-5.5',
              speed: 'fast',
              type: 'codex',
            },
          },
        },
        unrelated: { model: 'unrelated-model', provider: 'openai' },
      },
    };
    fixture.task = {
      ...initialTaskState,
      activeTaskId: 'T-1',
      taskDetailMap: {
        'T-1': {
          agentId: 'assignee',
          config: { model: 'gpt-5.4', provider: 'codex' },
          identifier: 'T-1',
          instruction: 'Inspect the configuration',
          name: 'Configured task',
          status: 'backlog',
        } satisfies TaskDetailData,
      },
    };
  });

  it('shows Codex settings instead of hiding the model area', () => {
    const { rerender } = render(<TaskModelConfig />);
    fireEvent.click(screen.getByRole('button', { name: 'taskDetail.runtimeConfig.title' }));
    // NOTICE:
    // JSDOM has no layout and Base UI marks zero-size anchors as hidden.
    // Assert the open state and rendered content here; Electron covers pixels.
    // Source: @base-ui/react Popover positioner data-anchor-hidden.
    // Remove when this regression runs in Vitest browser mode.
    expect(screen.getByRole('button', { name: 'taskDetail.runtimeConfig.title' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('codex', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('gpt-5.4', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('high', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('fast', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('taskDetail.runtimeConfig.source.task')).toBeInTheDocument();
    fixture.task.taskDetailMap['T-1'].status = 'running';
    rerender(<TaskModelConfig />);
    expect(screen.getByRole('button', { name: 'taskDetail.runtimeConfig.title' })).toBeVisible();
  });

  it('shows inherited Task configuration without inventing a Task override', () => {
    fixture.task.taskDetailMap['T-1'].config = {};
    render(<TaskModelConfig />);
    fireEvent.click(screen.getByRole('button', { name: 'taskDetail.runtimeConfig.title' }));
    expect(screen.getByText('gpt-5.5', { exact: true })).toBeInTheDocument();
    expect(screen.getAllByText('taskDetail.runtimeConfig.source.agent')).toHaveLength(4);
    expect(screen.queryByText('taskDetail.runtimeConfig.source.task')).not.toBeInTheDocument();
  });

  it('shows Amp mode in the trigger and inspector', () => {
    fixture.agent.agentMap.assignee = {
      agencyConfig: { heterogeneousProvider: { mode: 'high', type: 'amp' } },
    };
    fixture.task.taskDetailMap['T-1'].config = {};
    render(<TaskModelConfig />);
    const trigger = screen.getByRole('button', { name: 'taskDetail.runtimeConfig.title' });
    expect(trigger).toHaveTextContent('amp · high');
    fireEvent.click(trigger);
    expect(screen.getByText('taskDetail.runtimeConfig.field.mode')).toBeInTheDocument();
    expect(screen.queryByText('taskDetail.runtimeConfig.field.model')).not.toBeInTheDocument();
  });

  it('preserves the ordinary Agent model picker', () => {
    fixture.agent.agentMap.assignee = { model: 'gpt-4o', provider: 'openai' };
    fixture.task.taskDetailMap['T-1'].config = {};
    render(<TaskModelConfig />);
    expect(screen.getByRole('button', { name: 'openai / gpt-4o' })).toBeVisible();
  });
});
