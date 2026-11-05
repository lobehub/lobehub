const variant = new URL(location.href).searchParams.get('variant') ?? '';

const currentName = variant.includes('long')
  ? 'Migrate every remaining onboarding email template to the new layout and verify the links'
  : 'Write the release notes';

const taskState = {
  taskDetailMap: {
    'T-1': { id: 'T-1', identifier: 'T-1', name: 'Quarterly launch' },
    'T-2': {
      id: 'T-2',
      identifier: 'T-2',
      name: 'Prepare the announcement',
      parent: { id: 'T-1', identifier: 'T-1', name: 'Quarterly launch' },
    },
    'T-3': {
      id: 'T-3',
      identifier: 'T-3',
      name: currentName,
      parent: { id: 'T-2', identifier: 'T-2', name: 'Prepare the announcement' },
    },
  } as Record<string, unknown>,
  taskRefIndex: {} as Record<string, string>,
};

export const useTaskStore = <T>(selector: (state: typeof taskState) => T): T => selector(taskState);

export const useAgentDisplayMeta = () => undefined;

export const useActiveWorkspaceSlug = () => undefined;
export const getActiveWorkspaceSlug = () => undefined;

export const taskTitleSlug = (title?: string | null) =>
  (title ?? '').toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
