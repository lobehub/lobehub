import { describe, expect, it } from 'vitest';

import { resolveConnectorManagePolicyView } from './connectorManagePolicyView';

const OWNER = { canEditPolicy: true, canManage: true, memberManage: 'all_members' as const };
const MEMBER = { canEditPolicy: false, canManage: true, memberManage: 'all_members' as const };
const RESTRICTED = { canEditPolicy: false, canManage: false, memberManage: 'admins_only' as const };

describe('resolveConnectorManagePolicyView', () => {
  it('shows nothing outside a workspace', () => {
    for (const variant of ['column', 'page', 'toolbar'] as const)
      expect(resolveConnectorManagePolicyView(undefined, variant)).toBe('none');
  });

  it('puts the owner select in the header toolbar, not under the header', () => {
    expect(resolveConnectorManagePolicyView(OWNER, 'toolbar')).toBe('select');
    expect(resolveConnectorManagePolicyView(OWNER, 'page')).toBe('none');
  });

  it('tells a restricted member why once, under the header', () => {
    expect(resolveConnectorManagePolicyView(RESTRICTED, 'page')).toBe('notice');
    expect(resolveConnectorManagePolicyView(RESTRICTED, 'toolbar')).toBe('none');
  });

  it('stays silent for a member allowed to manage', () => {
    for (const variant of ['column', 'page', 'toolbar'] as const)
      expect(resolveConnectorManagePolicyView(MEMBER, variant)).toBe('none');
  });

  it('keeps both states in the sidebar column strip', () => {
    expect(resolveConnectorManagePolicyView(OWNER, 'column')).toBe('select');
    expect(resolveConnectorManagePolicyView(RESTRICTED, 'column')).toBe('notice');
  });
});
