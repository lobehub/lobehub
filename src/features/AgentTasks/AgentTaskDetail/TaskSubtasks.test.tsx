/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TaskSubtasks from './TaskSubtasks';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  runReadySubtasks: vi.fn(),
  taskState: {
    activeTaskId: 'T-parent',
    taskDetailMap: {
      'T-parent': {
        agentId: 'agt_parent',
        identifier: 'T-parent',
        instruction: 'Parent instruction',
        status: 'running',
        subtasks: [
          {
            assignee: { avatar: null, backgroundColor: null, id: 'agt_child', title: 'Child' },
            identifier: 'T-child',
            name: 'Child task',
            status: 'backlog',
          },
        ],
      },
    },
  } as any,
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ onClick }: { onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      action
    </button>
  ),
  Block: ({
    children,
    clickable,
    onClick,
  }: {
    children: ReactNode;
    clickable?: boolean;
    onClick?: () => void;
  }) =>
    clickable ? (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ) : (
      <div>{children}</div>
    ),
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Icon: () => <span>icon</span>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  showContextMenu: vi.fn(),
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
      modal: { confirm: vi.fn() },
    }),
  },
  ConfigProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tree: ({
    onSelect,
    treeData,
  }: {
    onSelect?: (keys: string[]) => void;
    treeData?: Array<{ key: string; title: ReactNode }>;
  }) => (
    <div>
      {treeData?.map((node) => (
        <button
          data-testid="subtask-tree-node"
          key={node.key}
          type="button"
          onClick={() => onSelect?.([node.key])}
        >
          {node.title}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('antd-style', () => ({
  cssVar: {
    colorTextDescription: '#999',
    colorTextSecondary: '#666',
  },
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  confirmModal: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-router', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('@/services/task', () => ({
  taskService: {
    previewSubtaskLayers: vi.fn(),
  },
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: any) =>
    selector({
      ...mocks.taskState,
      runReadySubtasks: mocks.runReadySubtasks,
    }),
}));

vi.mock('../AgentTaskList/CreateTaskInlineEntry', () => ({
  default: () => <div>create task</div>,
}));

vi.mock('../features/AssigneeAgentSelector', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../features/AssigneeAvatar', () => ({
  default: () => <span>assignee</span>,
}));

vi.mock('../features/TaskPriorityTag', () => ({
  default: () => <span>priority</span>,
}));

vi.mock('../features/TaskStatusTag', () => ({
  default: ({ children }: { children?: ReactNode }) => (
    <span data-testid="task-status-tag">{children ?? 'status'}</span>
  ),
}));

vi.mock('../features/TaskSubtaskProgressTag', () => ({
  default: () => <span>progress</span>,
}));

vi.mock('../features/TaskTriggerTag', () => ({
  default: () => <span>trigger</span>,
}));

vi.mock('../features/useTaskItemContextMenu', () => ({
  useTaskContextMenuActions: () => ({
    buildItems: vi.fn(() => []),
    installKeyboardHandlers: vi.fn(),
  }),
}));

vi.mock('../shared/AccordionArrowIcon', () => ({
  default: () => <span>arrow</span>,
}));

vi.mock('../shared/style', () => ({
  styles: { subtaskTree: 'subtask-tree' },
}));

vi.mock('./RunSubtasksPreview', () => ({
  default: () => <div>preview</div>,
}));

vi.mock('./TopicStatusIcon', () => ({
  default: () => <span data-testid="topic-status-icon">topic running</span>,
}));

describe('TaskSubtasks', () => {
  beforeEach(() => {
    mocks.navigate.mockClear();
    mocks.taskState.taskDetailMap['T-parent'].subtasks = [
      {
        assignee: { avatar: null, backgroundColor: null, id: 'agt_child', title: 'Child' },
        identifier: 'T-child',
        name: 'Child task',
        status: 'backlog',
      },
    ];
  });

  afterEach(() => {
    cleanup();
  });

  it("opens a selected subtask using the subtask's assignee agent", () => {
    render(<TaskSubtasks />);

    fireEvent.click(screen.getByTestId('subtask-tree-node'));

    expect(mocks.navigate).toHaveBeenCalledWith('/agent/agt_child/task/T-child');
  });

  it('falls back to the global task route when the selected subtask has no assignee', () => {
    mocks.taskState.taskDetailMap['T-parent'].subtasks = [
      {
        identifier: 'T-child',
        name: 'Child task',
        status: 'backlog',
      },
    ];

    render(<TaskSubtasks />);

    fireEvent.click(screen.getByTestId('subtask-tree-node'));

    expect(mocks.navigate).toHaveBeenCalledWith('/task/T-child');
  });

  it('uses the running topic status icon when a subtask has an active topic run', () => {
    mocks.taskState.taskDetailMap['T-parent'].subtasks = [
      {
        assignee: { avatar: null, backgroundColor: null, id: 'agt_child', title: 'Child' },
        identifier: 'T-child',
        name: 'Child task',
        runningTopic: { id: 'topic-running', operationId: 'op-running' },
        status: 'running',
      },
    ];

    render(<TaskSubtasks />);

    expect(screen.getByTestId('topic-status-icon')).toBeTruthy();
  });
});
