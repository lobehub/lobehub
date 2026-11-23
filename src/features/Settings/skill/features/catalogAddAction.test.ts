import { describe, expect, it } from 'vitest';

import { getCatalogAddAction } from './catalogAddAction';

const base = { canCreate: true, canManageShared: true, policyPending: false };

describe('getCatalogAddAction', () => {
  // Regression: "Add" was a menu whose second item, "Browse Skill Store",
  // stacked a store modal on top of the Marketplace catalog it was opened from.
  it('gives the connectors page one direct action: add a custom connector', () => {
    expect(getCatalogAddAction({ ...base, viewMode: 'connector' })).toEqual({
      disabled: false,
      kind: 'customConnector',
    });
  });

  it('gives the skills page one direct action: import a skill', () => {
    expect(getCatalogAddAction({ ...base, viewMode: 'skill' })).toEqual({
      disabled: false,
      kind: 'importSkill',
    });
    expect(getCatalogAddAction({ ...base, canCreate: false, viewMode: 'skill' }).disabled).toBe(
      true,
    );
  });

  it('disables a shared connector for a member the policy excludes, and says why', () => {
    expect(
      getCatalogAddAction({
        ...base,
        canManageShared: false,
        viewMode: 'connector',
        visibility: 'public',
      }),
    ).toEqual({ disabled: true, disabledReason: 'manageOnly', kind: 'customConnector' });
  });

  it('gives no reason while the policy is still loading', () => {
    expect(
      getCatalogAddAction({
        ...base,
        canManageShared: false,
        policyPending: true,
        viewMode: 'connector',
      }),
    ).toEqual({ disabled: true, kind: 'customConnector' });
  });

  it('lets anyone add a private connector', () => {
    expect(
      getCatalogAddAction({
        ...base,
        canManageShared: false,
        viewMode: 'connector',
        visibility: 'private',
      }).disabled,
    ).toBe(false);
  });
});
