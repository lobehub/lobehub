import type { ProjectDetail, ProjectListItem, ProjectStoreState } from './store';

export type ProjectProjectionRef =
  | { kind: 'detail'; queryKey: string; scope: string }
  | { kind: 'list'; queryKey: string; scope: string };
export type ProjectEffect =
  | { projection: ProjectProjectionRef; type: 'invalidate' | 'remove' }
  | { projection: ProjectProjectionRef; type: 'persist'; value: ProjectDetail | ProjectListItem[] };
export type ProjectDispatchAction =
  | { data: ProjectDetail; id: string; scope: string; type: 'hydrateDetail' | 'replaceDetail' }
  | { data: ProjectListItem[]; scope: string; type: 'hydrateList' | 'replaceList' }
  | { id: string; patch: Partial<ProjectListItem>; scope: string; type: 'optimisticUpdate' }
  | { id: string; project: ProjectListItem; scope: string; type: 'commitUpdate' }
  | { id: string; scope: string; type: 'rollbackUpdate' | 'commitDelete' }
  | { project: ProjectListItem; scope: string; type: 'commitCreate' };
export interface ProjectTransition {
  effects: ProjectEffect[];
  state: Pick<ProjectStoreState, 'projectDetails' | 'projectLists' | 'projectOptimisticPatches'>;
}

const detailRef = (scope: string, queryKey: string): ProjectProjectionRef => ({
  kind: 'detail',
  queryKey,
  scope,
});
const listRef = (scope: string): ProjectProjectionRef => ({ kind: 'list', queryKey: 'all', scope });
const reconcileList = (items: ProjectListItem[], project: ProjectListItem) => {
  let changed = false;
  const next = items.map((item) => {
    if (item.id !== project.id || item === project) return item;
    changed = true;
    return project;
  });
  return changed ? next : items;
};
const clearPatch = (state: ProjectStoreState, scope: string, id: string) => {
  const patches = state.projectOptimisticPatches[scope];
  if (!patches?.[id]) return state.projectOptimisticPatches;
  const next = { ...patches };
  delete next[id];
  return { ...state.projectOptimisticPatches, [scope]: next };
};

export const projectReducer = (
  state: ProjectStoreState,
  action: ProjectDispatchAction,
): ProjectTransition => {
  const effects: ProjectEffect[] = [];
  let projectDetails = state.projectDetails;
  let projectLists = state.projectLists;
  let projectOptimisticPatches = state.projectOptimisticPatches;

  switch (action.type) {
    case 'hydrateDetail': {
      if (!projectDetails[action.scope]?.[action.id])
        projectDetails = {
          ...projectDetails,
          [action.scope]: { ...projectDetails[action.scope], [action.id]: action.data },
        };
      break;
    }
    case 'replaceDetail': {
      projectDetails = {
        ...projectDetails,
        [action.scope]: { ...projectDetails[action.scope], [action.id]: action.data },
      };
      effects.push({
        projection: detailRef(action.scope, action.id),
        type: 'persist',
        value: action.data,
      });
      break;
    }
    case 'hydrateList': {
      if (!projectLists[action.scope])
        projectLists = { ...projectLists, [action.scope]: action.data };
      break;
    }
    case 'replaceList': {
      projectLists = { ...projectLists, [action.scope]: action.data };
      effects.push({ projection: listRef(action.scope), type: 'persist', value: action.data });
      break;
    }
    case 'optimisticUpdate': {
      projectOptimisticPatches = {
        ...projectOptimisticPatches,
        [action.scope]: {
          ...projectOptimisticPatches[action.scope],
          [action.id]: { ...projectOptimisticPatches[action.scope]?.[action.id], ...action.patch },
        },
      };
      break;
    }
    case 'rollbackUpdate': {
      projectOptimisticPatches = clearPatch(state, action.scope, action.id);
      break;
    }
    case 'commitUpdate': {
      projectOptimisticPatches = clearPatch(state, action.scope, action.id);
      const currentList = projectLists[action.scope];
      if (currentList) {
        const nextList = reconcileList(currentList, action.project);
        if (nextList !== currentList) {
          projectLists = { ...projectLists, [action.scope]: nextList };
          effects.push({ projection: listRef(action.scope), type: 'persist', value: nextList });
        }
      }
      const currentDetails = projectDetails[action.scope];
      if (currentDetails) {
        let nextDetails = currentDetails;
        for (const [queryKey, detail] of Object.entries(currentDetails)) {
          if (detail.project.id !== action.id) continue;
          const nextDetail = { ...detail, project: action.project };
          if (nextDetails === currentDetails) nextDetails = { ...currentDetails };
          nextDetails[queryKey] = nextDetail;
          effects.push({
            projection: detailRef(action.scope, queryKey),
            type: 'persist',
            value: nextDetail,
          });
        }
        if (nextDetails !== currentDetails)
          projectDetails = { ...projectDetails, [action.scope]: nextDetails };
      }
      break;
    }
    case 'commitCreate': {
      const current = projectLists[action.scope];
      if (current && !current.some((item) => item.id === action.project.id)) {
        const next = [action.project, ...current];
        projectLists = { ...projectLists, [action.scope]: next };
        effects.push({ projection: listRef(action.scope), type: 'persist', value: next });
      } else if (!current) effects.push({ projection: listRef(action.scope), type: 'invalidate' });
      break;
    }
    case 'commitDelete': {
      const current = projectLists[action.scope];
      if (current) {
        const next = current.filter((item) => item.id !== action.id);
        if (next.length !== current.length) {
          projectLists = { ...projectLists, [action.scope]: next };
          effects.push({ projection: listRef(action.scope), type: 'persist', value: next });
        }
      }
      const details = projectDetails[action.scope];
      if (details) {
        const next = { ...details };
        for (const [queryKey, detail] of Object.entries(details))
          if (detail.project.id === action.id) {
            delete next[queryKey];
            effects.push({ projection: detailRef(action.scope, queryKey), type: 'remove' });
          }
        projectDetails = { ...projectDetails, [action.scope]: next };
      }
      break;
    }
  }
  return { effects, state: { projectDetails, projectLists, projectOptimisticPatches } };
};
