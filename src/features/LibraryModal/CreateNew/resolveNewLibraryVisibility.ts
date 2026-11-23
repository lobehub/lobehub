/**
 * Visibility of a library about to be created. A caller that knows its scope (the knowledge
 * picker's Private / Workspace tab) wins; otherwise the Resources sidebar mode decides, where
 * "private space" means private and anything else means workspace.
 */
export const resolveNewLibraryVisibility = (
  requested: 'private' | 'public' | undefined,
  listVisibility: string | undefined,
): 'private' | 'public' => requested ?? (listVisibility === 'private' ? 'private' : 'public');
