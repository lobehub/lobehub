import { defineConfig } from '@/libs/next/proxy/define-config';

const { middleware } = defineConfig();

// required to be literal
export const config = {
  matcher: [
    // include any files in the api or trpc folders that might have an extension
    '/(api|trpc|webapi)(.*)',
    // include the /
    '/',
    '/community',
    '/community(.*)',
    '/labs',
    '/agent',
    '/agent(.*)',
    '/group',
    '/group(.*)',
    '/changelog(.*)',
    '/settings(.*)',
    '/image',
    '/resource',
    '/resource(.*)',
    '/profile(.*)',
    '/page',
    '/page(.*)',
    '/me',
    '/me(.*)',
    '/share(.*)',
    '/desktop-onboarding',
    '/desktop-onboarding(.*)',
    '/onboarding',

    '/signup(.*)',
    '/signin(.*)',
    '/verify-email(.*)',
    '/reset-password(.*)',
    '/auth-error(.*)',
    '/oauth(.*)',
    '/oidc(.*)',
    '/market-auth-callback(.*)',
  ],
};

export default middleware;
