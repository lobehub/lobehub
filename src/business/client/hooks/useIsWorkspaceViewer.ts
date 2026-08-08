// OSS default: no viewer role concept, every user has full member access.
// Cloud overrides this with the real workspace-role lookup.
export const useIsWorkspaceViewer = (): boolean => false;
