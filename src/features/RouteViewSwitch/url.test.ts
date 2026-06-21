import { describe, expect, it } from 'vitest';

import { LOBE_ROUTE_VIEW_QUERY, RouteViewPreference } from '@/const/routeView';

import { getDesktopVersionUrl, getMobileVersionUrl } from './url';

const expectPreference = (href: string, preference: RouteViewPreference) => {
  expect(new URL(href).searchParams.get(LOBE_ROUTE_VIEW_QUERY)).toBe(preference);
};

describe('route view URL helpers', () => {
  it('maps the mobile dev port to the desktop dev port and adds the desktop preference', () => {
    const desktopUrl = getDesktopVersionUrl('http://127.0.0.1:3012/me/profile?tab=a#bio');

    expect(desktopUrl).toBe('http://127.0.0.1:9876/me/profile?tab=a&lobe_route_view=desktop#bio');
    expectPreference(desktopUrl, RouteViewPreference.Desktop);
  });

  it('strips the mobile HTML entry while preserving search and hash', () => {
    const desktopUrl = getDesktopVersionUrl(
      'https://app.lobehub.com/index.mobile.html?debug=1#workspace',
    );

    expect(desktopUrl).toBe('https://app.lobehub.com/?debug=1&lobe_route_view=desktop#workspace');
    expectPreference(desktopUrl, RouteViewPreference.Desktop);
  });

  it('keeps regular production paths and adds the desktop preference override', () => {
    const desktopUrl = getDesktopVersionUrl('https://app.lobehub.com/acme/me/profile?x=1#settings');

    expect(desktopUrl).toBe(
      'https://app.lobehub.com/acme/me/profile?x=1&lobe_route_view=desktop#settings',
    );
    expectPreference(desktopUrl, RouteViewPreference.Desktop);
  });

  it('maps the desktop dev port to the mobile dev port and adds the mobile preference', () => {
    const mobileUrl = getMobileVersionUrl('http://127.0.0.1:9876/acme?tab=a#home');

    expect(mobileUrl).toBe('http://127.0.0.1:3012/acme?tab=a&lobe_route_view=mobile#home');
    expectPreference(mobileUrl, RouteViewPreference.Mobile);
  });

  it('opens the mobile dev root through the mobile HTML entry', () => {
    const mobileUrl = getMobileVersionUrl('http://127.0.0.1:9876/?debug=1#home');

    expect(mobileUrl).toBe(
      'http://127.0.0.1:3012/index.mobile.html?debug=1&lobe_route_view=mobile#home',
    );
    expectPreference(mobileUrl, RouteViewPreference.Mobile);
  });

  it('keeps production paths and adds the mobile preference override', () => {
    const mobileUrl = getMobileVersionUrl('https://app.lobehub.com/acme?x=1#workspace');

    expect(mobileUrl).toBe('https://app.lobehub.com/acme?x=1&lobe_route_view=mobile#workspace');
    expectPreference(mobileUrl, RouteViewPreference.Mobile);
  });
});
