export interface FetchWorkspaceMembersOptions {
  includeDeleted?: boolean;
}

export const useFetchWorkspaceMembers = (_options: FetchWorkspaceMembersOptions = {}) => ({
  data: [],
});
