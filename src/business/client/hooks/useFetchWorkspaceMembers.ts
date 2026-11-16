export interface FetchWorkspaceMembersOptions {
  /** Skip the request while false, keeping hook order stable. */
  enabled?: boolean;
  includeDeleted?: boolean;
}

export const useFetchWorkspaceMembers = (_options: FetchWorkspaceMembersOptions = {}) => ({
  data: [],
  isLoading: false,
});
