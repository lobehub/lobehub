import type { ReactNode } from 'react';

const noop = () => {};
const notExercised = () => {
  throw new Error('BUSINESS_SURFACE_OUTSIDE_STYLE_FIXTURE');
};

export const createPortal = (node: ReactNode) => node;

export const agentDisplayName = (agent?: { id?: string; title?: string }) =>
  agent?.title ?? agent?.id;
export const isTaskArchiveBlocked = () => false;

export const useActiveWorkspaceId = () => undefined;
export const useFetchAgentList = noop;
export const usePermission = () => ({ allowed: true });

export const homeAgentListSelectors = { allAgents: () => [] };
export const useHomeStore = <T,>(selector: (state: object) => T): T => selector({});

const userState = { userId: 'fixture-user' };
export const userProfileSelectors = { userId: (state: typeof userState) => state.userId };
export const useUserStore = <T,>(selector: (state: typeof userState) => T): T =>
  selector(userState);

export const PRIORITY_META = {};
export const STATUS_META = {};
export const hasWorkspaceMemberDirectory = () => false;
export const countTasksCreatedByOthers = () => 0;

const selectionState = { selectedIds: ['task-a', 'task-b'] };
export const useTaskSelectionStore = <T,>(selector: (state: typeof selectionState) => T): T =>
  selector(selectionState);
export const useTaskBatchActions = () => ({ run: notExercised, running: false });

const Unmounted = () => notExercised();
export default Unmounted;
