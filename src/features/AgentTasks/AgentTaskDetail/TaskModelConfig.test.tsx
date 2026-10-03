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

/** @example A Codex assignee remains inspectable when another Agent owns the surrounding chat. */
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

  /** @example New and running Tasks both expose all four dimensions with Task/Agent sources. */
  it('shows Codex settings instead of hiding the model area', () => {
    // ROOT CAUSE:
    //
    // TaskModelConfig returned null whenever the assignee used an external runtime.
    // A Task's own model override was consequently invisible.
    // The runtime inspector now reads the assignee and Task detail selectors.
    const { rerender } = render(<TaskModelConfig />);
    fireEvent.click(screen.getByRole('button', { name: 'taskDetail.runtimeConfig.title' }));
    /** @example The visible inspector names the runtime, selected model, effort and speed. */
    // NOTICE:
    // JSDOM has no layout and Base UI marks zero-size anchors as hidden.
    // Assert the open state and rendered content here; Electron covers pixels.
    // Source: @base-ui/react Popover positioner data-anchor-hidden.
    // Remove when this regression runs in Vitest browser mode.
    expect(screen.getByRole('button', { name: 'taskDetail.runtimeConfig.title' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    /** @example The opened inspector contains the runtime value. */
    expect(screen.getByText('codex', { exact: true })).toBeInTheDocument();
    /** @example The explicit Task pin wins over gpt-5.5. */
    expect(screen.getByText('gpt-5.4', { exact: true })).toBeInTheDocument();
    /** @example Effort remains inherited independently of the model pin. */
    expect(screen.getByText('high', { exact: true })).toBeInTheDocument();
    /** @example Speed remains inherited independently of the model pin. */
    expect(screen.getByText('fast', { exact: true })).toBeInTheDocument();
    /** @example The origin of the pinned model is explicit. */
    expect(screen.getByText('taskDetail.runtimeConfig.source.task')).toBeInTheDocument();
    fixture.task.taskDetailMap['T-1'].status = 'running';
    rerender(<TaskModelConfig />);
    /** @example Running status does not hide the inspector. */
    expect(screen.getByRole('button', { name: 'taskDetail.runtimeConfig.title' })).toBeVisible();
  });

  /** @example An Amp Task summarizes and labels its mode instead of a model. */
  it('shows Amp mode in the trigger and inspector', () => {
    fixture.agent.agentMap.assignee = {
      agencyConfig: { heterogeneousProvider: { mode: 'high', type: 'amp' } },
    };
    fixture.task.taskDetailMap['T-1'].config = {};
    render(<TaskModelConfig />);
    const trigger = screen.getByRole('button', { name: 'taskDetail.runtimeConfig.title' });
    /** @example The closed inspector already identifies the actual Amp mode. */
    expect(trigger).toHaveTextContent('amp · high');
    fireEvent.click(trigger);
    /** @example Amp exposes its supported mode field. */
    expect(screen.getByText('taskDetail.runtimeConfig.field.mode')).toBeInTheDocument();
    /** @example No unsupported model field is invented. */
    expect(screen.queryByText('taskDetail.runtimeConfig.field.model')).not.toBeInTheDocument();
  });

  /** @example A normal assignee retains the regular ModelSelect. */
  it('preserves the ordinary Agent model picker', () => {
    fixture.agent.agentMap.assignee = { model: 'gpt-4o', provider: 'openai' };
    fixture.task.taskDetailMap['T-1'].config = {};
    render(<TaskModelConfig />);
    /** @example The picker falls back to the assignee rather than the active chat Agent. */
    expect(screen.getByRole('button', { name: 'openai / gpt-4o' })).toBeVisible();
  });
});
