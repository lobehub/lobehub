import { usePermission } from '@/hooks/usePermission';

/**
 * Whether this viewer can open Settings → Subscription Accounts to add accounts
 * to the pool. In a workspace that page is admin-only, so a member who can
 * edit the agent but not the settings is told to ask an admin instead of being
 * sent to a page that refuses them.
 */
export const useCanManageAccountPool = (): boolean => usePermission('manage_settings').allowed;
