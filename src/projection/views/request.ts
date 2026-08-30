import type {
  ProjectionFragmentName,
  ProjectionIndex,
  ProjectionKind,
  ProjectionRecordHydrationRequest,
  ProjectionRef,
} from '@lobechat/types';

export const uniqueProjectionIds = (values: Iterable<string>): string[] => [...new Set(values)];

export const projectionRecordRequest = <Kind extends ProjectionKind>(
  kind: Kind,
  ids: Iterable<string>,
  fragments: readonly ProjectionFragmentName<Kind>[],
): ProjectionRecordHydrationRequest =>
  ({
    fragments: [...fragments],
    ids: uniqueProjectionIds(ids),
    kind,
  }) as ProjectionRecordHydrationRequest;

export const projectionRefsFromIndex = (index: ProjectionIndex | undefined): ProjectionRef[] => {
  if (!index) return [];
  if (index.key === 'home.sidebar') {
    return [
      ...index.pinned,
      ...index.groups.flatMap((group) => group.items),
      ...index.ungrouped,
      ...index.privatePinned,
      ...index.privateGroups.flatMap((group) => group.items),
      ...index.privateUngrouped,
    ];
  }
  if (index.key.startsWith('task.groupList:')) {
    const taskGroupIndex = index as Extract<ProjectionIndex, { key: `task.groupList:${string}` }>;
    return taskGroupIndex.groups.flatMap((group) => group.refs);
  }
  return 'refs' in index ? index.refs : [];
};
