import {
  LOBE_ROUTE_VIEW_COOKIE,
  LOBE_ROUTE_VIEW_QUERY,
  RouteViewPreference,
} from '@/const/routeView';

const MOBILE_DEV_PORT = '3012';
const DESKTOP_DEV_PORT = '9876';
const MOBILE_HTML_ENTRY = '/index.mobile.html';
const ROUTE_VIEW_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const stripMobileHtmlEntry = (url: URL) => {
  if (!url.pathname.endsWith(MOBILE_HTML_ENTRY)) return;

  url.pathname = url.pathname.slice(0, -MOBILE_HTML_ENTRY.length) || '/';
};

const ensureMobileHtmlEntryForDevRoot = (url: URL) => {
  if (url.port !== MOBILE_DEV_PORT) return;
  if (url.pathname !== '/' && url.pathname !== '/index.html') return;

  url.pathname = MOBILE_HTML_ENTRY;
};

export const getRouteViewUrl = (currentHref: string, preference: RouteViewPreference): string => {
  const url = new URL(currentHref);

  if (preference === RouteViewPreference.Desktop) {
    if (url.port === MOBILE_DEV_PORT) url.port = DESKTOP_DEV_PORT;
    stripMobileHtmlEntry(url);
  }

  if (preference === RouteViewPreference.Mobile) {
    if (url.port === DESKTOP_DEV_PORT) url.port = MOBILE_DEV_PORT;
    ensureMobileHtmlEntryForDevRoot(url);
  }

  url.searchParams.set(LOBE_ROUTE_VIEW_QUERY, preference);

  return url.toString();
};

export const getDesktopVersionUrl = (currentHref: string): string =>
  getRouteViewUrl(currentHref, RouteViewPreference.Desktop);

export const getMobileVersionUrl = (currentHref: string): string =>
  getRouteViewUrl(currentHref, RouteViewPreference.Mobile);

const persistRouteViewPreference = (preference: RouteViewPreference) => {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${LOBE_ROUTE_VIEW_COOKIE}=${preference}; Max-Age=${ROUTE_VIEW_COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
};

export const openRouteView = (preference: RouteViewPreference) => {
  if (typeof window === 'undefined') return;

  persistRouteViewPreference(preference);
  window.location.assign(getRouteViewUrl(window.location.href, preference));
};

export const openDesktopVersion = () => openRouteView(RouteViewPreference.Desktop);

export const openMobileVersion = () => openRouteView(RouteViewPreference.Mobile);
