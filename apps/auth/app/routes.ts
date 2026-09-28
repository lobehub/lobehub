import { index, route, type RouteConfig } from '@react-router/dev/routes';

export default [
  index('routes/homeRedirect.tsx'),
  route('signin', 'routes/signin.tsx'),
  route('signup', 'routes/signup.tsx'),
  route('verify-email', 'routes/verifyEmail.tsx'),
  route('reset-password', 'routes/resetPassword.tsx'),
  route('auth-error', 'routes/authError.tsx'),
  route('market-auth-callback', 'routes/marketAuthCallback.tsx'),
  route('oauth/consent/:uid', 'routes/oauthConsent.tsx'),
  route('oauth/device', 'routes/oauthDevice.tsx'),
  route('oauth/device/confirm', 'routes/oauthDeviceConfirm.tsx'),
  route('oauth/device/success', 'routes/oauthDeviceSuccess.tsx'),
  route('oauth/callback/success', 'routes/oauthCallbackSuccess.tsx'),
  route('oauth/callback/social', 'routes/oauthCallbackSocial.tsx'),
  route('oauth/callback/error', 'routes/oauthCallbackError.tsx'),
  route('*', 'routes/catchall.tsx'),
] satisfies RouteConfig;
