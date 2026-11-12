import { defineConfig } from '@/libs/next/proxy/define-config';

const { middleware } = defineConfig();

// required to be literal
export const config = {
  matcher: [
    // NOTE: `/api`, `/trpc`, `/webapi` are intentionally NOT matched. The
    // middleware is a no-op for them — `defaultMiddleware` short-circuits the
    // rewrite half via `backendApiEndpoints`, and they're all public routes, so
    // the better-auth session lookup is skipped. Auth lives in the route
    // handlers (`checkAuth`, trpc `protectedProcedure`), which return JSON 401s
    // rather than the HTML redirect-to-signin. Skipping the matcher avoids a
    // needless middleware invocation on the hottest backend traffic. (/oidc and
    // /oauth stay matched below — their middleware pass is still load-bearing.)
    // include the /
    '/',
    '/acceptance',
    '/acceptance(.*)',
    '/apps',
    '/apps(.*)',
    '/community',
    '/community(.*)',
    '/channels',
    '/channels/(.*)',
    '/dashboard',
    '/dashboard(.*)',
    '/labs',
    '/eval',
    '/eval(.*)',
    /** Shared-agent pages need the same SPA rewrite as the other client routes. */
    '/a',
    '/a/(.*)',
    '/agent',
    '/agent(.*)',
    '/group',
    '/group(.*)',
    '/changelog(.*)',
    '/settings(.*)',
    '/image',
    '/video',
    '/resource',
    '/resource(.*)',
    '/profile(.*)',
    '/invite/(.*)',
    '/projects',
    '/project',
    '/project/(.*)',
    '/page',
    '/page(.*)',
    '/tasks',
    '/tasks(.*)',
    '/task',
    '/task(.*)',
    '/goals',
    '/goals(.*)',
    '/goal',
    '/goal(.*)',
    '/me',
    '/me(.*)',
    '/share(.*)',

    '/onboarding',
    '/onboarding(.*)',

    '/signup(.*)',
    '/signin(.*)',
    '/verify-email(.*)',
    '/verify-im(.*)',
    // Retired report links: the Workbench redirects them into Acceptance.
    '/verify',
    '/verify/(.*)',
    '/reset-password(.*)',
    '/auth-error(.*)',
    '/oauth(.*)',
    // Not `/oidc/handoff/native`: a matched request has its whole body cloned and
    // buffered (up to `proxyClientMaxBodySize`) before the route handler runs,
    // which defeats that public endpoint's own 4 KiB cap. It needs no proxy pass:
    // `/oidc` is a backend passthrough and the route authenticates its caller.
    '/oidc',
    '/oidc/((?!handoff/native(?:/|$)).*)',
    '/market-auth-callback(.*)',
  ],
};

export default middleware;
