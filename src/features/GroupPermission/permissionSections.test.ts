import { describe, expect, it } from 'vitest';

import { resolveGroupPermissionSections } from './permissionSections';

const state = (overrides: Partial<Parameters<typeof resolveGroupPermissionSections>[0]>) => ({
  accessError: undefined,
  canManageAccess: true,
  hasSupervisor: true,
  isPrivate: false,
  isWorkspaceGroup: true,
  ...overrides,
});

describe('resolveGroupPermissionSections', () => {
  it('shows both cards for a shared workspace group', () => {
    const sections = resolveGroupPermissionSections(state({}));

    expect(sections.showAccessCard).toBe(true);
    expect(sections.showConfigCard).toBe(true);
    expect(sections.showPrivateNotice).toBe(false);
    expect(sections.accessDescKey).toBe('permission.page.groupGeneralAccessDesc');
  });

  describe('private group', () => {
    // Mirrors the Agent page: a private group configures every control ahead of
    // publishing, so it keeps the whole page plus the notice — it must not
    // degrade to a stripped-down view.
    it('keeps both cards and adds the publish notice', () => {
      const sections = resolveGroupPermissionSections(state({ isPrivate: true }));

      expect(sections.showPrivateNotice).toBe(true);
      expect(sections.showAccessCard).toBe(true);
      expect(sections.showConfigCard).toBe(true);
      expect(sections.showPersonalEmpty).toBe(false);
    });

    it('describes the access level as taking effect after publishing', () => {
      const sections = resolveGroupPermissionSections(state({ isPrivate: true }));

      expect(sections.accessDescKey).toBe('permission.page.groupAccessLevelPrivateHint');
    });

    it('still defers to the no-manage copy for a member who cannot re-level it', () => {
      const sections = resolveGroupPermissionSections(
        state({ canManageAccess: false, isPrivate: true }),
      );

      expect(sections.accessDescKey).toBe('permission.noManagePermission');
    });
  });

  it('shows only the personal empty state outside a workspace', () => {
    const sections = resolveGroupPermissionSections(state({ isWorkspaceGroup: false }));

    expect(sections.showPersonalEmpty).toBe(true);
    expect(sections.showAccessCard).toBe(false);
    expect(sections.showConfigCard).toBe(false);
    expect(sections.showPrivateNotice).toBe(false);
  });

  it('hides the Editable settings until the supervisor resolves', () => {
    // Both rows write to the supervisor agent; with no row to write to, an
    // enabled control would save to nothing.
    const sections = resolveGroupPermissionSections(state({ hasSupervisor: false }));

    expect(sections.showConfigCard).toBe(false);
    expect(sections.showAccessCard).toBe(true);
  });

  it('drops only the access card when its level fails to load', () => {
    // The two halves have independent sources — the group's permission row vs
    // the supervisor agent — so one failing must not blank the other.
    const sections = resolveGroupPermissionSections(state({ accessError: new Error('boom') }));

    expect(sections.showAccessCard).toBe(false);
    expect(sections.showConfigCard).toBe(true);
  });
});
