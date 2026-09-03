export const AUTH_I18N_SCRIPT_ID = 'auth-i18n';

export const AUTH_NAMESPACES = [
  'auth',
  'authError',
  'common',
  'error',
  'marketAuth',
  'oauth',
] as const;

export type AuthNamespace = (typeof AUTH_NAMESPACES)[number];

export type AuthResourceBundle = Record<AuthNamespace, Record<string, string>>;
