import { useState } from 'react';

// Explicit style-only data boundary: never replaces DOM, styles or UI primitives.
const notExercised = async () => {
  throw new Error('BUSINESS_MUTATION_OUTSIDE_STYLE_FIXTURE');
};
const homeActions = { removeGroup: notExercised, updateGroupName: notExercised };

export const useHomeStore = <T>(selector: (state: typeof homeActions) => T): T =>
  selector(homeActions);

export const useSidebarGroupVisibility = () => {
  const [visible, setVisible] = useState(
    new URL(location.href).searchParams.get('variant') !== 'hidden',
  );
  return {
    isSidebarGroupVisible: () => visible,
    setSidebarGroupVisible: async (_id: string, next: boolean) => setVisible(next),
  };
};

// PreviewToolbar imports this sibling, but ToolbarActionButton never renders it.
// Fail closed if a future fixture accidentally mounts it.
export const UnmountedBreadcrumb = () => {
  throw new Error('UNMOUNTED_SIBLING_RENDERED_IN_STYLE_FIXTURE');
};

const chatActions = { openLocalFile: notExercised };
export const useChatStore = <T>(selector: (state: typeof chatActions) => T): T =>
  selector(chatActions);
export const useProjectFiles = () => ({ data: { entries: [] } });
