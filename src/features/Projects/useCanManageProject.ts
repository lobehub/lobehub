import { usePermission } from '@/hooks/usePermission';

/**
 * Whether the current user may rename, delete or otherwise manage projects.
 * Mirrors the server: any member who can edit may manage a project they can
 * see, whoever created it; viewers cannot. Private projects are only listed for
 * their creator, so no per-row creator check is needed.
 */
export const useCanManageProject = (): boolean => usePermission('create_content').allowed;
