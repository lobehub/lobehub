import { describe, expect, it } from 'vitest';

import { reviewTargetView } from './reviewTargetView';

describe('reviewTargetView', () => {
  it('names the site, project, role and registered origin for an allowed site review', () => {
    expect(
      reviewTargetView({
        allowed: true,
        kind: 'site',
        origin: 'https://fieldnotes.app',
        projectName: 'Fieldnotes',
        role: 'admin',
        siteName: 'Marketing site',
      }),
    ).toEqual({
      kind: 'site',
      origin: 'https://fieldnotes.app',
      project: 'Fieldnotes',
      role: 'admin',
      site: 'Marketing site',
    });
  });

  it('shows the unregistered origin', () => {
    expect(
      reviewTargetView({
        allowed: false,
        kind: 'site',
        origin: 'https://fieldnotes-mirror.net',
        reason: 'unregistered',
      }),
    ).toEqual({ kind: 'unregistered', origin: 'https://fieldnotes-mirror.net' });
  });

  it('tells a non-member they have no access, without naming anything', () => {
    expect(reviewTargetView({ allowed: false, kind: 'site', reason: 'noAccess' })).toEqual({
      kind: 'siteDenied',
    });
  });

  it('keeps the acceptance wording for acceptance links', () => {
    expect(reviewTargetView({ allowed: true, kind: 'acceptance', title: 'Landing page' })).toEqual({
      denied: false,
      kind: 'acceptance',
      title: 'Landing page',
    });
    expect(reviewTargetView({ allowed: false, kind: 'acceptance' })).toEqual({
      denied: true,
      kind: 'acceptance',
      title: '',
    });
  });
});
