import { describe, expect, it } from 'vitest';

import { diffGeneralSettings, toGeneralSettingsDraft } from './generalSettingsForm';

const project = {
  avatar: '🧭',
  description: null,
  name: 'Website revamp',
  slug: 'website-revamp',
};

describe('toGeneralSettingsDraft', () => {
  it('fills empty strings for missing text fields and carries no type', () => {
    expect(toGeneralSettingsDraft({ ...project, slug: null, type: 'web' } as never)).toEqual({
      avatar: '🧭',
      description: '',
      name: 'Website revamp',
      slug: '',
    });
  });
});

describe('diffGeneralSettings', () => {
  const draft = toGeneralSettingsDraft(project);

  it('has nothing to save when the draft matches the project', () => {
    expect(diffGeneralSettings(project, draft)).toEqual({ count: 0, patch: {}, valid: true });
  });

  it('collects every changed field into one patch, trimmed', () => {
    expect(
      diffGeneralSettings(project, {
        avatar: null,
        description: '  Relaunch the marketing site  ',
        name: ' Website 2026 ',
        slug: 'site-2026',
      }),
    ).toEqual({
      count: 4,
      patch: {
        avatar: null,
        description: 'Relaunch the marketing site',
        name: 'Website 2026',
        slug: 'site-2026',
      },
      valid: true,
    });
  });

  it('clears the slug and description to null', () => {
    expect(
      diffGeneralSettings(
        { ...project, description: 'Old' },
        { ...draft, description: '   ', slug: '' },
      ).patch,
    ).toEqual({ description: null, slug: null });
  });

  it('ignores whitespace-only edits', () => {
    expect(diffGeneralSettings(project, { ...draft, name: ' Website revamp ' }).count).toBe(0);
  });

  it('is invalid with an empty name or a malformed slug', () => {
    expect(diffGeneralSettings(project, { ...draft, name: '  ' }).valid).toBe(false);
    expect(diffGeneralSettings(project, { ...draft, slug: '-bad-' }).valid).toBe(false);
  });
});
