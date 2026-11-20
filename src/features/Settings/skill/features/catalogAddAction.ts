import type { ConnectorVisibility } from '@lobechat/types';

import type { SkillViewMode } from './SkillList';

export interface CatalogAddActionInput {
  /** `create_content` permission: importing a skill creates content. */
  canCreate: boolean;
  /** The workspace member policy allows managing shared connectors. */
  canManageShared: boolean;
  /** The member policy is still loading. */
  policyPending: boolean;
  viewMode: SkillViewMode;
  visibility?: ConnectorVisibility;
}

export interface CatalogAddAction {
  disabled: boolean;
  /** Why the action is disabled, when the reason is known (not while loading). */
  disabledReason?: 'manageOnly';
  kind: 'customConnector' | 'importSkill';
}

/**
 * The page header's single primary action. Connectors add a custom server,
 * skills import one. Finding more lives in the Marketplace's own Discover
 * catalog, so the header offers no store entry and no menu: one action is a
 * button.
 */
export const getCatalogAddAction = ({
  canCreate,
  canManageShared,
  policyPending,
  viewMode,
  visibility,
}: CatalogAddActionInput): CatalogAddAction => {
  if (viewMode !== 'connector') return { disabled: !canCreate, kind: 'importSkill' };

  // A private connector is the caller's own; only the shared pool follows the policy.
  if (visibility === 'private' || canManageShared)
    return { disabled: false, kind: 'customConnector' };

  return policyPending
    ? { disabled: true, kind: 'customConnector' }
    : { disabled: true, disabledReason: 'manageOnly', kind: 'customConnector' };
};
