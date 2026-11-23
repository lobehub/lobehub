import { type WorkspaceConnectorMemberManage } from '@lobechat/types';

/**
 * Where the connector member policy renders. `column` is the bordered strip
 * under the sidebar list header; the page splits it in two: `toolbar` is the
 * owner's filled pill select in the header toolbar (the Codex scope dropdown),
 * `page` is a restricted member's one-line notice under the header.
 */
export type ConnectorManagePolicyVariant = 'column' | 'page' | 'toolbar';

/** What a slot shows: the policy select, the restricted notice, or nothing. */
export type ConnectorManagePolicyView = 'none' | 'notice' | 'select';

export interface ConnectorManagePolicyState {
  canEditPolicy: boolean;
  canManage: boolean;
  memberManage: WorkspaceConnectorMemberManage;
}

export const resolveConnectorManagePolicyView = (
  policy: ConnectorManagePolicyState | null | undefined,
  variant: ConnectorManagePolicyVariant,
): ConnectorManagePolicyView => {
  // Outside a workspace there is no shared pool to govern.
  if (!policy) return 'none';
  if (policy.canEditPolicy) return variant === 'page' ? 'none' : 'select';
  // A member allowed to manage has nothing to be told.
  if (policy.canManage) return 'none';
  return variant === 'toolbar' ? 'none' : 'notice';
};
