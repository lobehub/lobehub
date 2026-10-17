import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DeviceSwitcher from '../DeviceSwitcher';

const state = vi.hoisted(() => ({
  activeTopicId: undefined as string | undefined,
  pendingNewTopicDirectory: undefined as
    { agentId: string; projectWorkingDirectoryId: string } | undefined,
  setPendingNewTopicDirectory: vi.fn(),
  topics: {} as Record<string, { projectId?: string; projectWorkingDirectoryId?: string }>,
}));

const directoryState = vi.hoisted(() => ({
  all: [] as { deviceId: string; id: string; projectId: string }[],
  directoriesMap: {} as Record<string, { deviceId: string; id: string; projectId: string }[]>,
}));

const directories = vi.hoisted(() => [
  { deviceId: 'device-a', id: 'dir-a', projectId: 'project-1' },
  { deviceId: 'device-b', id: 'dir-b', projectId: 'project-1' },
]);

const pickerProps = vi.hoisted(() => ({ current: undefined as any }));

vi.mock('../../store', () => ({
  useChatInputStore: (selector: (s: object) => unknown) => selector({ topicId: undefined }),
}));

vi.mock('@/store/chat', () => {
  const useChatStore = (selector: (s: unknown) => unknown) => selector(state);
  useChatStore.getState = () => state;
  return { useChatStore };
});

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    getTopicById: (id: string) => (s: typeof state) => s.topics[id],
  },
}));

vi.mock('@/store/projectWorkingDirectory', () => ({
  useProjectDirectories: (projectId?: string) =>
    projectId ? (directoryState.directoriesMap[projectId] ?? []) : directoryState.all,
  useProjectDirectoryStore: (selector: (s: object) => unknown) =>
    selector({
      directoriesMap: directoryState.directoriesMap,
      moveTopic: vi.fn(),
      useFetchDirectories: () => undefined,
    }),
}));

vi.mock('../HeteroDeviceSwitcher', () => ({
  default: () => <div>general-picker</div>,
}));

vi.mock('../ProjectDeviceSwitcher', () => ({
  default: (props: any) => {
    pickerProps.current = props;
    return <div>project-picker:{props.directoryId}</div>;
  },
}));

describe('DeviceSwitcher', () => {
  beforeEach(() => {
    state.activeTopicId = undefined;
    state.pendingNewTopicDirectory = undefined;
    state.setPendingNewTopicDirectory.mockClear();
    state.topics = {};
    pickerProps.current = undefined;
    directoryState.all = directories;
    directoryState.directoriesMap = { 'project-1': directories };
  });

  // A device subgroup's "+" stages a blank conversation in that device's
  // directory; the composer must show that device, not the agent default.
  it('shows the staged project directory for a blank conversation', () => {
    state.pendingNewTopicDirectory = { agentId: 'agent-1', projectWorkingDirectoryId: 'dir-b' };

    render(<DeviceSwitcher agentId="agent-1" />);

    expect(screen.getByText('project-picker:dir-b')).toBeInTheDocument();
    expect(pickerProps.current.directories).toEqual(directories);
  });

  // The project-keyed entry is still loading (or failed) on a first visit; the
  // warm scope-wide rows already know the project's devices.
  it("falls back to the scope-wide rows until the project's own entry loads", () => {
    const otherProject = { deviceId: 'device-c', id: 'dir-c', projectId: 'project-2' };
    directoryState.all = [...directories, otherProject];
    directoryState.directoriesMap = {};
    state.pendingNewTopicDirectory = { agentId: 'agent-1', projectWorkingDirectoryId: 'dir-b' };

    render(<DeviceSwitcher agentId="agent-1" />);

    expect(screen.getByText('project-picker:dir-b')).toBeInTheDocument();
    expect(pickerProps.current.directories).toEqual(directories);
  });

  it('restages the blank conversation when another device is picked', () => {
    state.pendingNewTopicDirectory = { agentId: 'agent-1', projectWorkingDirectoryId: 'dir-b' };

    render(<DeviceSwitcher agentId="agent-1" />);
    pickerProps.current.onSelect({ directory: directories[0], label: 'Device A' });

    expect(state.setPendingNewTopicDirectory).toHaveBeenCalledWith({
      agentId: 'agent-1',
      projectWorkingDirectoryId: 'dir-a',
    });
  });

  it("ignores a staging made on another agent's conversation", () => {
    state.pendingNewTopicDirectory = { agentId: 'agent-2', projectWorkingDirectoryId: 'dir-b' };

    render(<DeviceSwitcher agentId="agent-1" />);

    expect(screen.getByText('general-picker')).toBeInTheDocument();
  });

  it('leaves an open plain topic on the general picker', () => {
    state.activeTopicId = 'topic-1';
    state.topics = { 'topic-1': {} };
    state.pendingNewTopicDirectory = { agentId: 'agent-1', projectWorkingDirectoryId: 'dir-b' };

    render(<DeviceSwitcher agentId="agent-1" />);

    expect(screen.getByText('general-picker')).toBeInTheDocument();
  });
});
