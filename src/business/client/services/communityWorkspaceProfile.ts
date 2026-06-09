export interface UpdateCommunityWorkspaceProfileInput {
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  description?: string;
  displayName?: string;
  namespace?: string;
  websiteUrl?: string;
}

export interface SetupCommunityWorkspaceProfileInput extends UpdateCommunityWorkspaceProfileInput {
  displayName: string;
  namespace: string;
}

export const setupCommunityWorkspaceProfile = async (
  _input: SetupCommunityWorkspaceProfileInput,
): Promise<void> => {};

export const updateCommunityWorkspaceProfile = async (
  _input: UpdateCommunityWorkspaceProfileInput,
): Promise<void> => {};

export const syncCommunityWorkspaceMembers = async (): Promise<void> => {};

export const checkCommunityWorkspaceNamespaceAvailable = async (
  _namespace: string,
): Promise<boolean> => true;

export const isCommunityWorkspaceNamespaceTakenError = (_error: unknown): boolean => false;
